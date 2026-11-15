// Personagem: cápsula cinemática do Rapier (KinematicCharacterController) + máquina de estados
// de animação do avatar voxel. Tudo em metros e gravidade real; as velocidades são proporcionais
// à altura do avatar (um boneco de 25 cm anda ~20 cm/s, como uma pessoa de 1,75 m anda ~1,4 m/s).
//
// Interações:
//  - pegar / carregar / soltar / arremessar bolas e caixas (física real ao soltar);
//  - subir sozinho em degraus baixos e escalar bordas altas ("mantle"): pule de frente para a borda
//    — dá para empilhar caixas e subir nelas para chegar em lugares mais altos.
import * as THREE from 'three';
import { G } from './world.js';

const UP = new THREE.Vector3(0, 1, 0);
const _want = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Character {
  constructor(world, avatar, scene) {
    this.world = world;
    this.R = world.R;
    this.avatar = avatar;
    scene.add(avatar.root);
    this.vel = new THREE.Vector3();
    this.p = new THREE.Vector3();
    this.visY = 0;
    this.yaw = 0;
    this.grounded = false;
    this.airTime = 0;
    this.lastSafe = new THREE.Vector3();
    this.emote = null;           // animação "por cima" (aceno, dança) até mexer o analógico
    this.state = 'idle';
    this.onLand = null;
    this.held = null;            // objeto carregado
    this.mantle = null;          // escalada em andamento
    this.pushT = 0;              // tempo empurrando um obstáculo (para subir degrau)
    this.body = null; this.collider = null;
    this.kcc = world.physics.createCharacterController(0.002);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.kcc.setMinSlopeSlideAngle(65 * Math.PI / 180);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setSlideEnabled(true);
    // objeto removido do mundo (fim de minigame, "Limpar"...) enquanto está nas mãos: solta antes
    world.onPropRemoved = (p) => { if (this.held === p) this.release(false); };
  }

  get height() { return this.avatar.height; }
  /** posição lógica (física). O boneco na tela segue esta posição com a altura suavizada (ver _visual) */
  get position() { return this.p; }

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
    this.mantle = null;
    this.lastSafe.copy(p);
    this.p.copy(p);
    this.visY = p.y;
    this.avatar.root.position.copy(p);
  }

  /** boneco na tela: x/z exatos; altura suavizada nos degrauzinhos do mapa (sem tremer), salto real se for grande */
  _visual(dt) {
    const root = this.avatar.root.position, H = this.height;
    const dy = this.p.y - this.visY;
    if (!this.grounded || this.mantle || Math.abs(dy) > 0.2 * H) this.visY = this.p.y;
    else this.visY += dy * Math.min(1, dt * 18);
    root.set(this.p.x, this.visY, this.p.z);
  }

  _embedded(x, y, z) {
    const R = this.R;
    // sonda pequena só na altura dos pés: pega "chão ruidoso" que surgiu por cima dos pés,
    // mas não paredes/objetos ao lado (a cápsula real nunca deixa encostar neles por dentro)
    if (!this._probe || this._probeH !== this.height) {
      this._probe = new R.Ball(this.radius * 0.5);
      this._probeH = this.height;
    }
    const feetY = y - this.half - this.radius;
    let hit = false;
    this.world.physics.intersectionsWithShape({ x, y: feetY + this.radius, z }, { x: 0, y: 0, z: 0, w: 1 }, this._probe,
      (c) => { if (!c.parent() || c.parent().isFixed()) { hit = true; return false; } return true; },
      undefined, undefined, this.collider);
    return hit;
  }

  /** desloca o personagem (correção da âncora do ARCore: o ponto físico "andou" no espaço de referência) */
  shift(dx, dy, dz) {
    if (!this.body) return;
    const t = this.body.translation();
    this.body.setTranslation({ x: t.x + dx, y: t.y + dy, z: t.z + dz }, true);
    this.p.x += dx; this.p.y += dy; this.p.z += dz; this.visY += dy;
    this.lastSafe.x += dx; this.lastSafe.y += dy; this.lastSafe.z += dz;
  }

  resize(H) {
    const p = this.p.clone();
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

  // ------------------------------------------------------------------ pegar / soltar / arremessar
  /** objeto mais perto ao alcance das mãos (ou null) */
  reachable(props) {
    if (!this.body || this.held) return null;
    const H = this.height, p = this.p;
    _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const hx = p.x + _fwd.x * H * 0.3, hy = p.y + H * 0.35, hz = p.z + _fwd.z * H * 0.3;
    let best = null, bd = Infinity;
    for (const pr of props) {
      const t = pr.body.translation();
      const d = Math.hypot(t.x - hx, (t.y - hy) * 0.7, t.z - hz) - pr.size * 0.5;
      if (d < H * 0.45 && d < bd) { bd = d; best = pr; }
    }
    return best;
  }

  grab(prop) {
    if (!prop || this.held) return false;
    const R = this.R;
    prop.body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
    for (let i = 0; i < prop.body.numColliders(); i++) prop.body.collider(i).setSensor(true); // não empurra o próprio avatar
    this.held = prop;
    prop.held = true;            // o mundo não remove objeto que está nas mãos (limite de objetos)
    this.avatar.carry = true;
    this.emote = null;
    this.avatar.play('pickUp', { loop: false, fade: 0.08, restart: true, speed: 1.6 });
    this.pickLock = 0.3;
    return true;
  }

  /** solta (throw=false) ou arremessa (throw=true) o que está nas mãos */
  release(throwIt = false, vel = null) {
    const pr = this.held;
    if (!pr) return null;
    const R = this.R, H = this.height;
    _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    // afasta um pouco do corpo antes de virar sólido (não esbarra na própria cápsula ao soltar)
    const t0 = pr.body.translation();
    pr.body.setTranslation({ x: t0.x + _fwd.x * H * 0.06, y: t0.y, z: t0.z + _fwd.z * H * 0.06 }, true);
    for (let i = 0; i < pr.body.numColliders(); i++) pr.body.collider(i).setSensor(false);
    pr.body.setBodyType(R.RigidBodyType.Dynamic, true);
    const k = Math.sqrt(H);
    if (vel) pr.body.setLinvel(vel, true);
    else if (throwIt) pr.body.setLinvel({ x: this.vel.x + _fwd.x * 3.2 * k, y: 2.2 * k, z: this.vel.z + _fwd.z * 3.2 * k }, true);
    else pr.body.setLinvel({ x: this.vel.x + _fwd.x * 0.4 * k, y: 0, z: this.vel.z + _fwd.z * 0.4 * k }, true);
    this.held = null;
    pr.held = false;
    this.avatar.carry = false;
    return pr;
  }

  _carry() {
    const pr = this.held;
    if (!pr) return;
    const H = this.height, p = this.p;
    _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const ahead = this.radius + pr.size * 0.55 + H * 0.04;
    pr.body.setNextKinematicTranslation({ x: p.x + _fwd.x * ahead, y: p.y + H * 0.56, z: p.z + _fwd.z * ahead });
    _q.setFromAxisAngle(UP, this.yaw);
    pr.body.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  }

  // ------------------------------------------------------------------ escalar bordas
  /** altura do topo de uma borda logo à frente (ou null). maxRise relativo aos pés. */
  ledgeAhead(maxRise) {
    // procura a borda em 3 distâncias à frente (o avatar pode parar a alguns cm do obstáculo)
    for (const k of [0.1, 0.22, 0.36]) {
      const l = this._ledgeAt(maxRise, this.radius + this.height * k);
      if (l) return l;
    }
    return null;
  }

  _ledgeAt(maxRise, d) {
    const H = this.height, p = this.p;
    _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const ox = p.x + _fwd.x * d, oz = p.z + _fwd.z * d, oy = p.y + maxRise + H * 0.05;
    const exclude = this.held ? this.held.body : undefined;
    const ray = this._ray || (this._ray = new this.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    ray.origin.x = ox; ray.origin.y = oy; ray.origin.z = oz;
    const hit = this.world.physics.castRay(ray, maxRise + H * 0.05 - H * 0.12, true, undefined, undefined, this.collider, exclude);
    if (!hit || hit.timeOfImpact < 1e-4) return null;        // nada à frente, ou alto demais (raio nasceu dentro)
    const top = oy - hit.timeOfImpact;
    const rise = top - p.y;
    if (rise < H * 0.16 || rise > maxRise) return null;
    // espaço livre em cima para o corpo
    const R = this.R;
    let blocked = false;
    const shape = this._headShape || (this._headShape = new R.Ball(this.radius * 0.8));
    if (this._headShapeH !== H) { this._headShape = new R.Ball(this.radius * 0.8); this._headShapeH = H; }
    this.world.physics.intersectionsWithShape({ x: ox, y: top + H * 0.5, z: oz }, { x: 0, y: 0, z: 0, w: 1 }, this._headShape,
      () => { blocked = true; return false; }, this.R.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider, exclude);
    return blocked ? null : { x: ox + _fwd.x * H * 0.06, y: top, z: oz + _fwd.z * H * 0.06, rise };
  }

  _startMantle(l) {
    const H = this.height, p = this.p;
    const tall = l.rise > H * 0.4;
    this.mantle = { t: 0, dur: (tall ? 0.55 : 0.28) * Math.sqrt(H / 0.25), from: p.clone(), to: new THREE.Vector3(l.x, l.y + 0.004, l.z), tall };
    this.vel.set(0, 0, 0);
    this.emote = null;
    if (tall) this.avatar.play('mantle', { loop: false, fade: 0.06, restart: true, speed: this.avatar.duration('mantle') / this.mantle.dur });
    this.onMantle?.(tall);
  }

  _updateMantle(dt) {
    const m = this.mantle, H = this.height;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    // primeiro sobe (até o topo), depois avança por cima da borda
    const ku = Math.min(1, k / 0.6), kf = Math.max(0, (k - 0.35) / 0.65);
    const ease = (x) => x * x * (3 - 2 * x);
    const y = m.from.y + (m.to.y - m.from.y) * ease(ku);
    const x = m.from.x + (m.to.x - m.from.x) * ease(kf);
    const z = m.from.z + (m.to.z - m.from.z) * ease(kf);
    this.body.setNextKinematicTranslation({ x, y: y + H / 2 + 0.002, z });
    this.p.set(x, y, z);
    if (k >= 1) { this.mantle = null; this.grounded = true; this.airTime = 0; this.lastSafe.copy(this.p); }
  }

  /**
   * @param {number} dt
   * @param {{move:THREE.Vector3, mag:number, sprint:number, walk:boolean, jump:boolean}} input  move = direção no mundo (y=0)
   */
  update(dt, input) {
    if (!this.body) return;
    const H = this.height;
    if (this.mantle) {
      const tall = this.mantle.tall;
      this._updateMantle(dt);           // pode terminar a escalada (this.mantle vira null)
      this._carry();
      this.avatar.root.quaternion.setFromAxisAngle(UP, this.yaw);
      if (!tall) this._animate(dt, 0.5);
      this._visual(dt);
      this.avatar.update(dt);
      return;
    }
    const carryK = this.held ? 0.8 : 1;
    const walkV = 0.8 * H * carryK, runV = 1.9 * H * carryK, sprintV = 3.1 * H * carryK;
    let target = 0;
    if (input.mag > 0) {
      target = input.walk ? walkV * input.mag : (input.mag < 0.55 ? walkV * input.mag / 0.55 : runV * input.mag);
      if (input.sprint > 0.3 && input.mag > 0.5) target = THREE.MathUtils.lerp(runV, sprintV, input.sprint);
      this.emote = this.emote && this.emote.startsWith('dance') && input.mag < 0.2 ? this.emote : null;
    }
    // aceleração horizontal (menos controle no ar)
    _want.copy(input.move).setY(0);
    if (_want.lengthSq() > 0) _want.normalize().multiplyScalar(target);
    // resposta rápida no chão (arranca e para sem "patinar"), menos controle no ar
    const acc = (this.grounded ? (_want.lengthSq() > 0 ? 18 : 24) : 3) * dt;
    this.vel.x += (_want.x - this.vel.x) * Math.min(1, acc);
    this.vel.z += (_want.z - this.vel.z) * Math.min(1, acc);

    // pulo e gravidade de verdade — com buffer (guarda o toque 0,15 s) e coyote time (0,12 s após perder o chão)
    if (input.jump) this.jumpBuffer = 0.15; else this.jumpBuffer = Math.max(0, (this.jumpBuffer || 0) - dt);
    this.coyote = this.grounded ? 0.12 : Math.max(0, (this.coyote || 0) - dt);

    // escalar: pulo de frente para uma borda alta (até ~1x a altura) ou no ar perto de uma borda
    const pushing = input.mag > 0.35;
    if (pushing && (this.jumpBuffer > 0 || (!this.grounded && this.airTime > 0.05))) {
      const l = this.ledgeAhead(this.grounded ? H * 1.0 : Math.max(H * 0.2, H * 0.65));
      if (l) { this.jumpBuffer = 0; this._startMantle(l); this._visual(dt); this.avatar.update(dt); return; }
    }
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.jumpBuffer = 0; this.coyote = 0;
      const hJump = 0.55 * H;
      this.vel.y = Math.sqrt(2 * G * hJump);
      this.grounded = false; this.airTime = 0.001; this.emote = null;
      this.avatar.play(input.mag > 0.3 ? 'jumpFwdRise' : 'jumpRise', { loop: false, fade: 0.08, restart: true });
    }
    this.vel.y -= G * dt;
    const desired = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    // filtro nativo (ignora o objeto carregado, que vira sensor) — um predicado em JS aqui deixava o
    // movimento ~13x mais lento: era chamado para cada bloco de colisão por perto, todo quadro
    this.kcc.computeColliderMovement(this.collider, desired, this.R.QueryFilterFlags.EXCLUDE_SENSORS);
    const mv = this.kcc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    const t = this.body.translation();
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    const wantH = Math.hypot(desired.x, desired.z), gotH = Math.hypot(mv.x, mv.z);
    if (dt > 0) {
      // velocidade real (após colisões)
      const realY = mv.y / dt;
      if (this.grounded && this.vel.y < 0) this.vel.y = 0;
      else if (this.vel.y > 0 && realY < this.vel.y * 0.5) this.vel.y = Math.min(this.vel.y, realY); // bateu a cabeça
      this.vel.x = mv.x / dt; this.vel.z = mv.z / dt;
    }
    this.p.set(nx, ny - H / 2 - 0.002, nz);

    // subir sozinho num degrau baixo (até ~meia altura) quando empurra contra ele
    // (acumula enquanto bloqueado e decai devagar: deslizar de lado na quina não zera)
    if (this.grounded && pushing && wantH > 1e-5 && gotH < wantH * 0.5) this.pushT += dt;
    else this.pushT = Math.max(0, this.pushT - dt * 0.5);
    if (this.pushT > 0.15) {
      this.pushT = 0;
      const l = this.ledgeAhead(H * 0.5);
      if (l) this._startMantle(l);
    }

    // destravar SÓ se a cápsula estiver enterrada na geometria (voxel ruidoso surgiu dentro dela)
    if ((this.checkT = (this.checkT || 0) + dt) > 0.25) {
      this.checkT = 0;
      if (this._embedded(nx, ny, nz)) {
        this.body.setNextKinematicTranslation({ x: nx, y: ny + 0.12 * H, z: nz });
        this.p.y += 0.12 * H;
        this.vel.y = Math.max(0, this.vel.y);
      }
    }

    if (this.grounded) {
      if (!wasGrounded && this.airTime > 0.25) {
        this.onLand?.(this.airTime);
        if (this.airTime > 0.45) { this.avatar.play('land', { loop: false, fade: 0.05, restart: true }); this.landLock = 0.25; }
      }
      this.airTime = 0;
      this.lastSafe.copy(this.p);
    } else this.airTime += dt;

    // virar para onde anda
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (input.mag > 0.15) {
      const ty = Math.atan2(input.move.x, input.move.z);
      let d = ty - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, 18 * dt);
    }
    this.avatar.root.quaternion.setFromAxisAngle(UP, this.yaw);
    this._carry();

    // caiu da mesa e sumiu no vazio (chão não mapeado): volta para o último lugar seguro
    const floorY = Number.isFinite(this.world.minY) ? this.world.minY - 2.5 : this.lastSafe.y - 3;
    if (this.p.y < floorY) {
      if (this.held) this.release(false);
      this.spawn(this.lastSafe.clone().add(new THREE.Vector3(0, 0.05, 0)));
      this.onRespawn?.();
    }

    if (this.pickLock > 0) this.pickLock -= dt;
    this._visual(dt);
    this._animate(dt, hs / H);
    this.avatar.update(dt);
  }

  _animate(dt, rel) {
    const a = this.avatar;
    if (this.pickLock > 0) return;
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
    if (rel < 0.08) { a.play('idle', { fade: 0.15 }); this.state = 'idle'; }
    else if (rel < 1.2) { a.play('walk', { fade: 0.12, speed: THREE.MathUtils.clamp(rel / 0.8, 0.5, 1.6) }); this.state = 'walk'; }
    else if (rel < 2.5) { a.play('run', { fade: 0.12, speed: THREE.MathUtils.clamp(rel / 1.9, 0.7, 1.4) }); this.state = 'run'; }
    else { a.play('sprint', { fade: 0.12, speed: THREE.MathUtils.clamp(rel / 3.1, 0.8, 1.3) }); this.state = 'sprint'; }
  }
}
