"""
Reconstrução 3D offline de uma sessão gravada pelo backend (data/session-*/frames.rmd).

Cada quadro tem o depth do ARCore + a pose da câmera (SLAM) + projeção, em escala 1:1 (metros).

  python tools/reconstruct_open3d.py data/session-XXXX              -> nuvem fundida (só numpy)
  python tools/reconstruct_open3d.py data/session-XXXX --mesh       -> malha TSDF (precisa: pip install open3d)

Saídas na pasta da sessão: fused_points.ply e/ou mesh_tsdf.ply
"""
import argparse
import os
import struct
import sys

import numpy as np

HEADER = 220
MAGIC = 0x31444D52


def read_frames(path):
    with open(path, 'rb') as fh:
        while True:
            n = fh.read(4)
            if len(n) < 4:
                return
            size = struct.unpack('<I', n)[0]
            buf = fh.read(size)
            if len(buf) < size:
                return
            if struct.unpack_from('<I', buf, 0)[0] != MAGIC:
                continue
            w, h = struct.unpack_from('<HH', buf, 16)
            fmt = buf[20]
            scale = struct.unpack_from('<f', buf, 24)[0]
            mats = np.frombuffer(buf, '<f4', 48, 28).astype(np.float64)
            dtype = '<f4' if fmt == 1 else '<u2'
            data = np.frombuffer(buf, dtype, w * h, HEADER).astype(np.float64).reshape(h, w) * scale
            yield {
                'w': w, 'h': h, 'depth': data,
                # column-major (WebXR) -> row-major numpy
                'world_from_view': mats[0:16].reshape(4, 4).T,
                'proj': mats[16:32].reshape(4, 4).T,
                'ndfnv': mats[32:48].reshape(4, 4).T,
            }


def backproject(f, step=1, max_depth=4.0):
    """mesma matemática de shared/depth.js, vetorizada"""
    h, w = f['h'], f['w']
    ys, xs = np.mgrid[0:h:step, 0:w:step]
    d = f['depth'][ys, xs]
    ok = (d > 0.15) & (d < max_depth)
    xs, ys, d = xs[ok], ys[ok], d[ok]
    view_from_depth = np.linalg.inv(f['ndfnv'])
    b = np.stack([(xs + 0.5) / w, (ys + 0.5) / h, np.zeros_like(d), np.ones_like(d)])
    t = view_from_depth @ b
    u, v = t[0] / t[3], t[1] / t[3]
    inv_proj = np.linalg.inv(f['proj'])
    r = inv_proj @ np.stack([u * 2 - 1, 1 - v * 2, np.ones_like(u), np.ones_like(u)])
    r = r[:3] / r[3]
    k = d / -r[2]
    pv = np.vstack([r * k, np.ones_like(k)])
    pw = f['world_from_view'] @ pv
    return pw[:3].T


def write_ply(path, pts, colors=None):
    with open(path, 'wb') as fh:
        head = f'ply\nformat binary_little_endian 1.0\nelement vertex {len(pts)}\nproperty float x\nproperty float y\nproperty float z\n'
        if colors is not None:
            head += 'property uchar red\nproperty uchar green\nproperty uchar blue\n'
        fh.write((head + 'end_header\n').encode('ascii'))
        if colors is None:
            fh.write(pts.astype('<f4').tobytes())
        else:
            rec = np.zeros(len(pts), dtype=[('p', '<f4', 3), ('c', 'u1', 3)])
            rec['p'] = pts
            rec['c'] = colors
            fh.write(rec.tobytes())


def fused_cloud(frames, voxel):
    acc = {}
    for f in frames:
        p = backproject(f)
        keys = np.floor(p / voxel).astype(np.int64)
        for key, pt in zip(map(tuple, keys), p):
            s = acc.get(key)
            if s is None:
                acc[key] = [pt.copy(), 1]
            else:
                s[0] += pt
                s[1] += 1
    pts = np.array([s[0] / s[1] for s in acc.values() if s[1] >= 2])
    if len(pts) == 0:
        return pts, None
    y = pts[:, 1]
    t = (y - y.min()) / max(1e-6, y.max() - y.min())
    colors = np.stack([255 * t, 80 + 150 * (1 - abs(t - 0.5) * 2), 255 * (1 - t)], 1).clip(0, 255).astype(np.uint8)
    return pts, colors


def tsdf_mesh(frames, voxel, out):
    import open3d as o3d  # noqa: import tardio, é opcional
    vol = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=voxel, sdf_trunc=voxel * 4,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.NoColor)
    n = 0
    for f in frames:
        # reamostra o depth para a orientação da view (o buffer do celular pode estar girado)
        h, w = f['h'], f['w']
        view_from_depth = np.linalg.inv(f['ndfnv'])
        a = view_from_depth[:2, :2]
        swap = abs(a[0, 0]) < abs(a[0, 1])
        W, H = (h, w) if swap else (w, h)
        img = np.zeros((H, W), np.float32)
        ys, xs = np.mgrid[0:h, 0:w]
        b = np.stack([(xs.ravel() + 0.5) / w, (ys.ravel() + 0.5) / h, np.zeros(w * h), np.ones(w * h)])
        t = view_from_depth @ b
        u = np.clip((t[0] / t[3] * W).astype(int), 0, W - 1)
        v = np.clip((t[1] / t[3] * H).astype(int), 0, H - 1)
        img[v, u] = f['depth'].ravel()
        P = f['proj']
        fx, fy = P[0, 0] * W / 2, P[1, 1] * H / 2
        cx, cy = (1 - P[0, 2]) * W / 2, (1 + P[1, 2]) * H / 2
        intr = o3d.camera.PinholeCameraIntrinsic(W, H, fx, fy, cx, cy)
        cv_from_gl = np.diag([1, -1, -1, 1.0])
        extr = np.linalg.inv(f['world_from_view'] @ cv_from_gl)
        depth = o3d.geometry.Image(img)
        color = o3d.geometry.Image(np.full((H, W, 3), 128, np.uint8))
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(color, depth, depth_scale=1.0, depth_trunc=4.0, convert_rgb_to_intensity=False)
        vol.integrate(rgbd, intr, extr)
        n += 1
    mesh = vol.extract_triangle_mesh()
    mesh.compute_vertex_normals()
    o3d.io.write_triangle_mesh(out, mesh)
    return n, len(mesh.triangles)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('session')
    ap.add_argument('--voxel', type=float, default=0.01)
    ap.add_argument('--mesh', action='store_true', help='malha TSDF com Open3D')
    a = ap.parse_args()
    rmd = os.path.join(a.session, 'frames.rmd')
    if not os.path.exists(rmd):
        sys.exit('não achei ' + rmd)
    frames = list(read_frames(rmd))
    print(f'{len(frames)} quadros lidos')
    pts, colors = fused_cloud(frames, a.voxel)
    out = os.path.join(a.session, 'fused_points.ply')
    write_ply(out, pts, colors)
    print(f'nuvem fundida: {len(pts)} pontos -> {out}')
    if a.mesh:
        try:
            n, tris = tsdf_mesh(frames, a.voxel, os.path.join(a.session, 'mesh_tsdf.ply'))
            print(f'malha TSDF: {n} quadros integrados, {tris} triângulos -> mesh_tsdf.ply')
        except ImportError:
            print('Open3D não instalado: pip install open3d')


if __name__ == '__main__':
    main()
