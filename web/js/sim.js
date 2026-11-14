// Simulador de "mundo real" para testar no PC sem celular: uma mesa de bar, objetos em cima,
// chão e parede. A câmera do navegador faz o papel do celular e gera quadros de depth sintéticos
// no MESMO formato do WebXR/ARCore (Uint16 em mm + matrizes), passando pelo mesmo pipeline
// (mapa de voxels local + envio ao backend).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { IDENTITY } from '/shared/mat4.js';

export class Sim {
  constructor(scene, camera, dom) {
    this.camera = camera;
    this.group = new THREE.Group();
    this.group.name = 'mundo-simulado';
    scene.add(this.group);
    scene.background = new THREE.Color(0x9fb4c4);
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a3b1c, roughness: 0.45 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.4, metalness: 0.6 });
    const add = (geo, mat, x, y, z, ry = 0) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry;
      m.receiveShadow = true; m.castShadow = true; this.group.add(m); return m;
    };
    add(new THREE.BoxGeometry(8, 0.02, 8), new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.9 }), 0, -0.01, 0);
    add(new THREE.BoxGeometry(8, 3, 0.1), new THREE.MeshStandardMaterial({ color: 0xe8e2d6 }), 0, 1.5, -2.2);
    add(new THREE.BoxGeometry(1.2, 0.03, 0.8), wood, 0, 0.735, 0);                       // tampo
    add(new THREE.CylinderGeometry(0.03, 0.03, 0.72, 12), metal, 0, 0.36, 0);            // pé central
    add(new THREE.BoxGeometry(0.16, 0.11, 0.12), new THREE.MeshStandardMaterial({ color: 0xefe7d6 }), 0.33, 0.805, -0.2, 0.3); // porta-guardanapo
    add(new THREE.CylinderGeometry(0.045, 0.035, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0xc23b22 }), -0.38, 0.8, -0.22); // copo
    add(new THREE.BoxGeometry(0.3, 0.04, 0.3), new THREE.MeshStandardMaterial({ color: 0x2c4a7a }), -0.15, 0.77, 0.15, 0.4);    // livro
    add(new THREE.BoxGeometry(0.5, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: 0x5d6b3a }), 1.3, 0.225, 0.4);          // caixote no chão
    add(new THREE.BoxGeometry(0.4, 0.02, 0.06), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }), -0.95, 0.4, 0.2, 0.2);    // rampa
    this.group.children.at(-1).rotation.z = -0.6;
    this.targets = this.group.children;

    camera.position.set(0.05, 1.25, 0.95);
    this.controls = new OrbitControls(camera, dom);
    this.controls.target.set(0, 0.75, -0.05);
    this.controls.enableDamping = true;
    this.controls.update();

    this.raycaster = new THREE.Raycaster();
    this.W = 120; this.H = 68;
    this.seq = 0;
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._ndc = new THREE.Vector2();
    this._sph = new THREE.Spherical();
  }

  /** analógico direito orbita a "câmera do celular" */
  orbit(rx, ry, dt) {
    if (!rx && !ry) return;
    const off = this._v.copy(this.camera.position).sub(this.controls.target);
    this._sph.setFromVector3(off);
    this._sph.theta -= rx * 1.6 * dt;
    this._sph.phi = THREE.MathUtils.clamp(this._sph.phi + ry * 1.2 * dt, 0.15, 1.5);
    off.setFromSpherical(this._sph);
    this.camera.position.copy(this.controls.target).add(off);
  }

  update() { this.controls.update(); }

  /** quadro de depth sintético (formato shared/protocol.js) */
  depthFrame(noise = 0.004) {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const { W, H } = this;
    const data = new Uint16Array(W * H);
    const camPos = this._v.setFromMatrixPosition(cam.matrixWorld).clone();
    const fwd = new THREE.Vector3(0, 0, -1).transformDirection(cam.matrixWorld);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        this._ndc.set(((x + 0.5) / W) * 2 - 1, 1 - ((y + 0.5) / H) * 2);
        this.raycaster.setFromCamera(this._ndc, cam);
        this.raycaster.far = 6;
        const hit = this.raycaster.intersectObjects(this.targets, false)[0];
        if (!hit) continue;
        const z = this._d.copy(hit.point).sub(camPos).dot(fwd); // profundidade no eixo óptico
        data[y * W + x] = Math.max(1, Math.round(z * (1 + (Math.random() * 2 - 1) * noise) * 1000));
      }
    }
    return {
      seq: this.seq++, timestamp: performance.now(), width: W, height: H, data,
      rawValueToMeters: 0.001,
      worldFromView: Float32Array.from(cam.matrixWorld.elements),
      projection: Float32Array.from(cam.projectionMatrix.elements),
      normDepthFromNormView: Float32Array.from(IDENTITY),
    };
  }

  /** "hit-test" do simulador: raio do centro da tela */
  hitTest() {
    this._ndc.set(0, 0);
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.targets, false)[0];
    if (!hit || !hit.face) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    return n.y > 0.7 ? hit.point.clone() : null;
  }
}
