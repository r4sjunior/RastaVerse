"""
Converte o avatar do VoxEdit (pasta ME002) para web/assets/avatar.json.

Formatos (engenharia reversa, conferida byte a byte nos arquivos do ME002):

  .vxm (VXMC)  u32 w,h,d | f32 pivô normalizado xyz | ...LOD/texturas (ignorado)...
               | u8 nCores | nCores x (b,g,r,a,emissivo) | u8 nCamadas | nome\0 | u8 visível
               | RLE (u8 qtd, u8 corIdx; 0xFF = vazio; qtd 0 encerra)  idx -> x=i/(h*d), y=(i/d)%h, z=i%d
  .vxr (VXR9)  anim padrão\0 | u32 | template\0 | \0 | nó raiz
               nó = id\0 arquivo\0 | 29 bytes (flags/limites, ignorado) | u32 nFilhos | filhos
  .vxa (VXA3)  md5[16] | nome\0 | u32 | nó raiz
               nó = 7 trilhas (pos x,y,z | rot x,y,z (euler rad) | escala) | u32 nFilhos | filhos
               trilha = u32 nKeys | keys{u32 frame, u32 interp, [u8 só na rot x], f32 valor}

Uso:  python tools/vox2json.py [pasta_entrada] [saida.json]
"""
import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'ME002')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'web', 'assets', 'avatar.json')

# Animações que o app usa (chave interna -> nome no VoxEdit)
ANIMS = {
    'idle': 'Idle 01', 'idle2': 'Idle 02', 'idleBreak': 'IdleBreak 01',
    'walk': 'Walk 01', 'run': 'Run 01', 'sprint': 'Sprint 01',
    'jumpRise': 'Jump Rise 01', 'jumpHover': 'Jump Hover 01', 'jumpFall': 'Jump Fall 01',
    'jumpFwdRise': 'JumpForward Rise 01', 'jumpFwdFall': 'JumpForward Fall 01',
    'land': 'Land 01', 'hi': 'Hi 01', 'wave': 'Wave 01', 'clap': 'Clap 01',
    'cheer': 'Cheer 01', 'sitIdle': 'Sit Idle 01', 'push': 'Push 01',
    'climb': 'Climb 01', 'stunned': 'Stunned 01', 'getHit': 'Get Hit 01',
    'danceBreakin': 'Dance Breakin 01', 'danceCWalk': 'Dance C-Walk 01',
    'danceShuffle': 'Dance Shuffle 01', 'danceHype': 'Dance Hype 01',
    'danceSnoop': 'Dance SnoopDogg 01', 'danceTechno': 'Dance Techno 01',
    'vibe': 'Vibe 01', 'tpose': 'T',
}


def cstr(d, p):
    e = d.index(b'\0', p)
    return d[p:e].decode('latin1'), e + 1


def parse_vxm(path):
    d = open(path, 'rb').read()
    assert d[:3] == b'VXM', path
    w, h, dp = struct.unpack_from('<3I', d, 4)
    pivot = struct.unpack_from('<3f', d, 16)
    total = w * h * dp
    # O cabeçalho de LOD varia; achamos o stream RLE válido mais longo que fecha
    # exatamente em w*h*d e termina com 0.
    best = None
    for o in range(0x20, len(d) - 2):
        t, i = 0, o
        while i < len(d) - 1:
            L = d[i]
            if L == 0:
                break
            t += L
            i += 2
            if t > total:
                break
        if t == total and i < len(d) and d[i] == 0:
            if best is None or (i - o) > (best[1] - best[0]):
                best = (o, i)
    assert best, 'RLE não encontrado em ' + path
    o, _ = best
    # cabeçalho da camada: u8 nCamadas | nome\0 | u8 visível
    q = o - 2  # o \0 do nome
    assert d[q] == 0
    s = q - 1
    while s > 0 and 32 <= d[s] < 127:
        s -= 1
    pal_end = s  # byte do nCamadas
    palette = None
    for n in range(255, 0, -1):
        st = pal_end - 5 * n
        if st - 1 >= 0 and d[st - 1] == n:
            palette = [d[st + k * 5: st + k * 5 + 4] for k in range(n)]
            break
    assert palette, 'paleta não encontrada em ' + path
    vox = []
    i, idx = o, 0
    while d[i] != 0:
        L, c = d[i], d[i + 1]
        i += 2
        if c != 0xFF:
            for j in range(idx, idx + L):
                x = j // (h * dp)
                y = (j // dp) % h
                z = j % dp
                vox.append((x, y, z, c))
        idx += L
    return {'size': [w, h, dp], 'pivot': list(pivot), 'voxels': vox, 'palette': palette}


def parse_vxr(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'VXR9', path
    p = 4
    default_anim, p = cstr(d, p)
    p += 4
    _template, p = cstr(d, p)
    _empty, p = cstr(d, p)
    bones = []

    def node(parent):
        nonlocal p
        nid, p = cstr(d, p)
        fn, p = cstr(d, p)
        p += 29
        nc = struct.unpack_from('<I', d, p)[0]
        p += 4
        me = len(bones)
        bones.append({'name': nid, 'parent': parent, 'part': fn or None})
        for _ in range(nc):
            node(me)

    node(-1)
    return bones


def parse_vxa(path, nbones):
    d = open(path, 'rb').read()
    assert d[:4] == b'VXA3', path
    p = 20
    name, p = cstr(d, p)
    p += 4
    tracks = []
    maxf = 0

    def track(extra):
        nonlocal p, maxf
        n = struct.unpack_from('<I', d, p)[0]
        p += 4
        keys = []
        for _ in range(n):
            fr, interp = struct.unpack_from('<II', d, p)
            p += 8
            if extra:
                p += 1
            v = struct.unpack_from('<f', d, p)[0]
            p += 4
            keys.append([fr, round(v, 5)])
            maxf = max(maxf, fr)
        return keys

    def node():
        nonlocal p
        t = [track(False) for _ in range(3)] + [track(True)] + [track(False) for _ in range(3)]
        tracks.append(t)
        nc = struct.unpack_from('<I', d, p)[0]
        p += 4
        for _ in range(nc):
            node()

    node()
    assert p == len(d), f'{path}: sobrou {len(d) - p} bytes'
    assert len(tracks) == nbones, path
    return {'name': name, 'frames': maxf, 'tracks': tracks}


def main():
    bones = parse_vxr(os.path.join(SRC, 'me.vxr'))
    parts = {}
    palette = None
    for b in bones:
        if b['part'] and b['part'] not in parts:
            m = parse_vxm(os.path.join(SRC, b['part']))
            palette = palette or m['palette']
            flat = []
            for v in m['voxels']:
                flat.extend(v)
            parts[b['part']] = {'size': m['size'], 'pivot': m['pivot'], 'voxels': flat}
    anims = {}
    for key, nm in ANIMS.items():
        f = os.path.join(SRC, f'me.{nm}.vxa')
        if os.path.exists(f):
            anims[key] = parse_vxa(f, len(bones))
        else:
            print('aviso: animação ausente', nm)
    out = {
        'source': 'VoxEdit ME002 (me.vxr)',
        'fps': 24,
        'palette': ['#%02x%02x%02x' % (c[2], c[1], c[0]) for c in palette],  # VoxEdit guarda BGR
        'bones': bones,
        'parts': parts,
        'anims': anims,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'))
    nvox = sum(len(p['voxels']) // 4 for p in parts.values())
    print(f'ok: {len(bones)} ossos, {len(parts)} partes, {nvox} voxels, {len(anims)} animações -> {OUT} '
          f'({os.path.getsize(OUT) // 1024} KB)')


if __name__ == '__main__':
    main()
