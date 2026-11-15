// Modo câmera: para aparelhos sem WebXR AR (iPhone/Safari, Android sem ARCore).
// Vídeo da câmera traseira ao fundo + giroscópio (DeviceOrientation) girando a câmera 3D, com o
// chão real modelado como um plano a CAM_H abaixo do celular. O avatar anda, pula e cai nesse chão,
// e os minigames usam a faixa de chão mapeada em volta do usuário.
import * as THREE from 'three';

export const CAM_H = 1.35;             // altura típica do celular na mão (em pé), em metros
const LONG_FOV = 64;                   // campo de visão da câmera principal no lado maior da imagem (graus)

const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // câmera olhando pela traseira do aparelho
const _target = new THREE.Quaternion();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();
const D2R = Math.PI / 180;

export class CamView {
  /** dispara os pedidos de permissão — chamar DIRETO no toque do usuário (exigência do iOS) */
  static request() {
    let motion = Promise.resolve('granted');
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') motion = DOE.requestPermission().catch(() => 'denied');
    const video = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    return { motion, video };
  }

  static available() {
    return !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia && matchMedia('(pointer: coarse)').matches);
  }

  constructor(camera) {
    this.camera = camera;
    this.video = null;
    this.orient = null;              // última leitura do giroscópio (graus)
    this.hasMotion = false;
    // sem giroscópio: olhando um pouco para baixo, para o chão à frente
    this.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.75, 0, 0, 'YXZ'));
    this._fovKey = '';
    this._onOrient = (e) => {
      if (e.alpha == null && e.beta == null) return;
      this.orient = { a: e.alpha || 0, b: e.beta || 0, g: e.gamma || 0 };
      this.hasMotion = true;
    };
  }

  /** liga o vídeo (stream já autorizado) e o giroscópio */
  async start(stream) {
    const v = document.createElement('video');
    v.id = 'camfeed';
    v.setAttribute('playsinline', ''); v.setAttribute('muted', ''); v.setAttribute('autoplay', '');
    v.muted = true; v.playsInline = true;
    v.srcObject = stream;
    document.body.prepend(v);
    this.video = v;
    await v.play().catch(() => {});
    addEventListener('deviceorientation', this._onOrient);
    this.camera.position.set(0, CAM_H, 0);
  }

  /** atualiza orientação e campo de visão da câmera 3D (chamar a cada quadro) */
  update(dt) {
    const cam = this.camera;
    if (this.orient) {
      const o = this.orient;
      const screenAng = (screen.orientation?.angle ?? window.orientation ?? 0) * D2R;
      _euler.set(o.b * D2R, o.a * D2R, -o.g * D2R, 'YXZ');
      _target.setFromEuler(_euler).multiply(_q1).multiply(_q0.setFromAxisAngle(_zee, -screenAng));
      // filtro leve: tira o tremido do sensor sem atrasar o giro
      if (this.q.dot(_target) < 0) _target.set(-_target.x, -_target.y, -_target.z, -_target.w);
      this.q.slerp(_target, Math.min(1, 1 - Math.exp(-dt * 30)));
    }
    cam.quaternion.copy(this.q);
    cam.position.set(0, CAM_H, 0);
    this._fitFov();
    cam.updateMatrixWorld();
  }

  /** campo de visão vertical da tela, igual ao da imagem da câmera recortada em "cover" */
  _fitFov() {
    const v = this.video, cam = this.camera;
    const vw = v?.videoWidth || 0, vh = v?.videoHeight || 0, W = innerWidth, H = innerHeight;
    const key = `${vw}x${vh}@${W}x${H}`;
    if (key === this._fovKey) return;
    this._fovKey = key;
    cam.aspect = W / H;
    if (vw && vh) {
      const tLong = Math.tan(LONG_FOV * D2R / 2);
      const tV = vh >= vw ? tLong : tLong * vh / vw;            // meia-abertura vertical da imagem
      const scale = Math.max(W / vw, H / vh);                    // object-fit: cover
      const tS = tV * H / (vh * scale);
      cam.fov = 2 * Math.atan(tS) / D2R;
    } else cam.fov = H > W ? 62 : 44;
    cam.updateProjectionMatrix();
  }

  /** ponto do chão (y = 0) visto no ponto (nx, ny) da tela, em coordenadas normalizadas -1..1 */
  floorAt(nx = 0, ny = 0, maxDist = 6) {
    _ndc.set(nx, ny);
    _ray.setFromCamera(_ndc, this.camera);
    if (_ray.ray.direction.y > -0.05) return null;
    if (!_ray.ray.intersectPlane(_plane, _hit)) return null;
    if (_hit.distanceTo(this.camera.position) > maxDist) return null;
    return _hit;
  }

  stop() {
    removeEventListener('deviceorientation', this._onOrient);
    this.video?.srcObject?.getTracks?.().forEach((t) => t.stop());
  }
}
