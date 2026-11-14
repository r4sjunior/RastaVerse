// Personagem: cápsula cinemática do Rapier (KinematicCharacterController) + máquina de estados
// de animação do avatar voxel. Tudo em metros e gravidade real; as velocidades são proporcionais
// à altura do avatar (um boneco de 25 cm anda ~20 cm/s, como uma pessoa de 1,75 m anda ~1,4 m/s).
import * as THREE from 'three';
import { G } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);

export class Character {
  constructor(world, avatar, scene) {
    this.world = world;
    this.R = world.R;
    this.avatar = avatar;
    scene.add(avatar.root);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.grounded = false;
    this.airTime = 0;
    this.lastSafe = new THREE.Vector3();
    this.emote = null;           // animação "por cima" (aceno, dança) até mexer o analógico
    this.state = 'idle';
    this.onLand = null;
    this.body = null; this.collider = null;
    this.kcc = world.physics.createCharacterController(0.002);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.kcc.setMinSlopeSlideAngle(65 * Math.PI / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setSlideEnabled(true);
  }

  get height() { return this.avatar.height; }
  get position() { return this.avatar.root.position; }

  /** coloca o personagem com os pés em p */
  spawn(p, height = this.avatar.height) {
    this.avatar.setHeight(height);
    const R = this.R, H = height;
    this.radius = 0.16 * H;
    this.half = Math.max(0.01, H / 2 - this.radius);
    if (this.body) this.world.physics.removeRigidBody(this.body);
    this.body = this.world.physics.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y + H / 2 + 0.002, p.z));
    this.collider = this.world.physics.createCollider(R.ColliderDesc.capsule(this.half, this.radius).setMass(70 * (H / 1.75) ** 3), this.body);
    this.kcc.enableAutostep(0.3 * H, 0.05 * H, false);
    this.kcc.enableSnapToGround(0.25 * H);
    this.kcc.setCharacterMass(70 * (H / 1.75) ** 3);
    this.kcc.setOffset(Math.max(0.001, 0.01 * H));
    this.vel.set(0, 0, 0);
    this.lastSafe.copy(p);
    this.position.copy(p);
  }

  resize(H) {
    const p = this.position.clone();
    this.spawn(p.add(new THREE.Vector3(0, 0.01, 0)), THREE.MathUtils.clamp(H, 0.06, 2.0));
  }

  playEmote(name, loop = false) {
    if (!this.avatar.has(name)) return;
    this.emote = name;
    this.avatar.play(name, {
      loop, restart: true, fade: 0.2,
      onFinish: loop ? null : () => { if (this.emote === name) this.emote = null; },
    });
  }

  /**
   * @param {number} dt
   * @param {{move:THREE.Vector3, mag:number, sprint:number, walk:boolean, jump:boolean}} input  move = direção no mundo (y=0)
   */
  update(dt, input) {
    if (!this.body) return;
    const H = this.height;
    const walkV = 0.8 * H, runV = 1.9 * H, sprintV = 3.1 * H;
    let target = 0;
    if (input.mag > 0) {
      target = input.walk ? walkV * input.mag : (input.mag < 0.55 ? walkV * input.mag / 0.55 : runV * input.mag);
      if (input.sprint > 0.3 && input.mag > 0.5) target = THREE.MathUtils.lerp(runV, sprintV, input.sprint);
      this.emote = this.emote && this.emote.startsWith('dance') && input.mag < 0.2 ? this.emote : null;
    }
    // aceleração horizontal (menos controle no ar)
    const want = input.move.clone().setY(0);
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(target);
    const acc = (this.grounded ? 10 : 2.5) * dt;
    this.vel.x += (want.x - this.vel.x) * Math.min(1, acc);
    this.vel.z += (want.z - this.vel.z) * Math.min(1, acc);

    // pulo e gravidade de verdade — com buffer (guarda o toque 0,15 s) e coyote time (0,12 s após perder o chão)
    if (input.jump) this.jumpBuffer = 0.15; else this.jumpBuffer = Math.max(0, (this.jumpBuffer || 0) - dt);
    this.coyote = this.grounded ? 0.12 : Math.max(0, (this.coyote || 0) - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.jumpBuffer = 0; this.coyote = 0;
      const hJump = 0.55 * H;
      this.vel.y = Math.sqrt(2 * G * hJump);
      this.grounded = false; this.airTime = 0.001; this.emote = null;
      this.avatar.play(input.mag > 0.3 ? 'jumpFwdRise' : 'jumpRise', { loop: false, fade: 0.08, restart: true });
    }
    this.vel.y -= G * dt;
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.kcc.computeColliderMovement(this.collider, desired);
    const mv = this.kcc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    const t = this.body.translation();
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    if (dt > 0) {
      // velocidade real (após colisões)
      const realY = mv.y / dt;
      if (this.grounded && this.vel.y < 0) this.vel.y = 0;
      else if (this.vel.y > 0 && realY < this.vel.y * 0.5) this.vel.y = Math.min(this.vel.y, realY); // bateu a cabeça
      this.vel.x = mv.x / dt; this.vel.z = mv.z / dt;
    }
    this.position.set(nx, ny - H / 2 - 0.002, nz);

    if (this.grounded) {
      if (!wasGrounded && this.airTime > 0.25) {
        this.onLand?.(this.airTime);
        if (this.airTime > 0.45) { this.avatar.play('land', { loop: false, fade: 0.05, restart: true }); this.landLock = 0.25; }
      }
      this.airTime = 0;
      this.lastSafe.copy(this.position);
    } else this.airTime += dt;

    // virar para onde anda
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (hs > 0.15 * H && input.mag > 0) {
      const ty = Math.atan2(this.vel.x, this.vel.z);
      let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, 12 * dt);
    }
    this.avatar.root.quaternion.setFromAxisAngle(UP, this.yaw);

    // caiu da mesa e sumiu no vazio (chão não mapeado): volta para o último lugar seguro
    const floorY = Number.isFinite(this.world.minY) ? this.world.minY - 2.5 : this.lastSafe.y - 3;
    if (this.position.y < floorY) this.spawn(this.lastSafe.clone().add(new THREE.Vector3(0, 0.05, 0)));

    this._animate(dt, hs / H);
    this.avatar.update(dt);
  }

  _animate(dt, rel) {
    const a = this.avatar;
    if (this.landLock > 0) { this.landLock -= dt; if (rel < 0.2) return; }
    if (!this.grounded && this.airTime > 0.08) {
      this.emote = null;
      const up = this.vel.y > 0.3 * Math.sqrt(this.height);
      const cur = a.current?.name;
      if (up) { if (cur !== 'jumpRise' && cur !== 'jumpFwdRise') a.play('jumpRise', { loop: false }); }
      else if (this.vel.y > -1.2) { if (cur !== 'jumpHover') a.play('jumpHover', { loop: false, fade: 0.15 }); }
      else a.play('jumpFall', { loop: true, fade: 0.2 });
      this.state = 'air';
      return;
    }
    if (this.emote) return;
    if (rel < 0.08) { a.play('idle'); this.state = 'idle'; }
    else if (rel < 1.2) { a.play('walk', { speed: THREE.MathUtils.clamp(rel / 0.8, 0.5, 1.6) }); this.state = 'walk'; }
    else if (rel < 2.5) { a.play('run', { speed: THREE.MathUtils.clamp(rel / 1.9, 0.7, 1.4) }); this.state = 'run'; }
    else { a.play('sprint', { speed: THREE.MathUtils.clamp(rel / 3.1, 0.8, 1.3) }); this.state = 'sprint'; }
  }
}
