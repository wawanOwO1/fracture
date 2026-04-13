import * as THREE from 'three'

const MAX_HP = 100
const CUBE_SIZE = 0.75
const HIT_RADIUS = 0.9

/** Satu sel grid `main.js` (gridSize / gridDivisions). */
const TILE = 2

/** Spawn awal: jarak horizontal dari pusat player, dalam tile (~8–14 × TILE world). */
const SPAWN_MIN_TILES_FROM_PLAYER = 8
const SPAWN_MAX_TILES_FROM_PLAYER = 14

/**
 * Posisi xz acak di cincin sekitar player (untuk spawn awal, jauh dari pusat).
 * @param {number} playerX
 * @param {number} playerZ
 * @returns {{ x: number, z: number }}
 */
export function pickInitialSpawnXZ(playerX, playerZ) {
  const minR = SPAWN_MIN_TILES_FROM_PLAYER * TILE
  const maxR = SPAWN_MAX_TILES_FROM_PLAYER * TILE
  const dist = minR + Math.random() * (maxR - minR)
  const a = Math.random() * Math.PI * 2
  return {
    x: playerX + Math.sin(a) * dist,
    z: playerZ + Math.cos(a) * dist
  }
}

const MOVE_CHASE = 4.75
const MOVE_ROAM = 2.65
const ROAM_SEGMENT_MIN = 1.4
const ROAM_SEGMENT_MAX = 3.2
const MELEE_RANGE = 0.72
const MELEE_COOLDOWN = 0.85

/** Setelah player keluar dari kerucut, kejar sebentar agar tidak “kedip” di tepi. */
const LOST_SIGHT_GRACE = 0.55

/** Peluang setelah satu segmen jalan: berhenti memandang sekitar (0–1). */
const PAUSE_AFTER_MOVE_CHANCE = 0.42
const PAUSE_LOOK_MIN = 0.55
const PAUSE_LOOK_MAX = 1.85
const LOOK_TURN_SPEED = 1.15
const LOOK_TURN_JITTER = 0.9

const _toPlayer = new THREE.Vector3()
const _move = new THREE.Vector3()
const _forward = new THREE.Vector3()
const _tmp = new THREE.Vector3()
let ENEMY_ID_SEQ = 1

function buildVisionWedgeGeometry(range, halfAngleRad, segments = 24) {
  const positions = []
  const indices = []
  const y = 0.018
  positions.push(0, y, 0)
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const a = -halfAngleRad + t * 2 * halfAngleRad
    const x = range * Math.sin(a)
    const z = range * Math.cos(a)
    positions.push(x, y, z)
  }
  for (let i = 1; i <= segments + 1; i++) {
    indices.push(0, i, i + 1)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

const ENEMY_TYPES = {
  WATCHER: 'watcher',
  CHARGER: 'charger',
  BOSS: 'boss'
}

const TYPE_CONFIG = {
  [ENEMY_TYPES.WATCHER]: {
    maxHp: 100,
    size: 0.75,
    hitRadius: 0.9,
    color: 0xcc2222,
    emissive: 0x3a0808,
    moveRoam: 2.4,
    moveChase: 4.8,
    meleeRange: 0.72,
    meleeCooldown: 0.85
  },
  [ENEMY_TYPES.CHARGER]: {
    maxHp: 130,
    size: 0.84,
    hitRadius: 0.95,
    color: 0xff8c2a,
    emissive: 0x4a2406,
    triggerRange: 7.2,
    windup: 0.6,
    chargeSpeed: 18,
    chargeDuration: 0.58,
    cooldown: 1.25,
    meleeRange: 0.85,
    meleeCooldown: 1.1
  },
  [ENEMY_TYPES.BOSS]: {
    maxHp: 480,
    size: 1.95,
    hitRadius: 1.72,
    color: 0x6611aa,
    emissive: 0x22003d,
    meleeRange: 1.25,
    meleeCooldown: 0.45
  }
}

export class Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {number} x
   * @param {number} z
   */
  constructor(scene, x, z, options = {}) {
    this.scene = scene
    this.id = ENEMY_ID_SEQ++
    this.type = options.type || ENEMY_TYPES.WATCHER
    this.config = TYPE_CONFIG[this.type] || TYPE_CONFIG[ENEMY_TYPES.WATCHER]
    this.maxHp = this.config.maxHp || MAX_HP
    this.hp = this.maxHp
    this.alive = true
    this.active = options.active ?? true

    const tiles = 1 + Math.floor(Math.random() * 3)
    this.visionRange = (4 + tiles * 1.4) * TILE * 0.55
    this.visionHalfAngle = ((26 + Math.random() * 22) * Math.PI) / 180
    this._visionCosThreshold = Math.cos(this.visionHalfAngle)
    if (this.type === ENEMY_TYPES.CHARGER) {
      this.visionRange = 6.8
      this.visionHalfAngle = Math.PI * 0.28
      this._visionCosThreshold = Math.cos(this.visionHalfAngle)
    }
    if (this.type === ENEMY_TYPES.BOSS) {
      this.visionRange = 10.5
      this.visionHalfAngle = Math.PI * 0.5
      this._visionCosThreshold = Math.cos(this.visionHalfAngle)
    }

    this._roamSegmentTimer = ROAM_SEGMENT_MIN + Math.random() * (ROAM_SEGMENT_MAX - ROAM_SEGMENT_MIN)
    this._roamDir = new THREE.Vector3()
    this._pickRoamDir()

    this._pauseLookTimer = 0
    this._lookTurnDir = 1
    this._lookTurnChangeTimer = 0.35 + Math.random() * 0.5

    this._lostSightTimer = 0
    this._playerInVision = false

    this._meleeCooldown = 0
    this._alertTimer = 0
    this._state = 'patrol'
    this._chargerTimer = 0
    this._chargeDir = new THREE.Vector3(0, 0, 1)
    this._chargerHitIds = new Set()
    this._bossAwakenRadius = options.bossAwakenRadius ?? 14
    this._bossPhase = 1
    this._bossPatternTimer = 0
    this._bossSpinDir = Math.random() < 0.5 ? -1 : 1

    const half = (this.config.size || CUBE_SIZE) / 2
    this.group = new THREE.Group()
    this.group.position.set(x, half, z)
    this.group.rotation.y = Math.random() * Math.PI * 2

    const cubeGeo = new THREE.BoxGeometry(this.config.size, this.config.size, this.config.size)
    const cubeMat = new THREE.MeshStandardMaterial({
      color: this.config.color,
      emissive: this.config.emissive
    })
    this.cube = new THREE.Mesh(cubeGeo, cubeMat)
    this.cube.castShadow = true
    this.cube.receiveShadow = true
    this.group.add(this.cube)

    const wedgeGeo = buildVisionWedgeGeometry(this.visionRange, this.visionHalfAngle)
    this._visionGeo = wedgeGeo
    this.visionMat = new THREE.MeshBasicMaterial({
      color: 0x4488cc,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    this.visionMesh = new THREE.Mesh(wedgeGeo, this.visionMat)
    this.visionMesh.renderOrder = 1
    this.group.add(this.visionMesh)

    const barW = 0.55
    const barH = 0.08
    this.barGroup = new THREE.Group()
    this.barGroup.position.y = half + 0.12

    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a22,
      depthTest: true,
      transparent: true,
      opacity: 0.95
    })
    this.barBg = new THREE.Mesh(new THREE.PlaneGeometry(barW, barH), bgMat)
    this.barBg.position.z = -0.001

    const fgMat = new THREE.MeshBasicMaterial({
      color: 0x22dd66,
      depthTest: true
    })
    this.barFill = new THREE.Mesh(new THREE.PlaneGeometry(barW, barH), fgMat)
    this.barFill.position.z = 0.001

    this.barGroup.add(this.barBg, this.barFill)
    this.group.add(this.barGroup)

    scene.add(this.group)
    this.spawn = new THREE.Vector3(x, half, z)
    this._barHalfW = barW / 2
    this._hitCenter = new THREE.Vector3()
    this._refreshBarVisual()
    this._applyTypeVisual()
  }

  _pickRoamDir() {
    const a = Math.random() * Math.PI * 2
    this._roamDir.set(Math.sin(a), 0, Math.cos(a))
  }

  _syncForwardFromRotation() {
    const y = this.group.rotation.y
    _forward.set(Math.sin(y), 0, Math.cos(y))
  }

  /**
   * Sama seperti player: `atan2(dx, dz)` → maju `(sin(y), cos(y))`.
   * @param {import('./player.js').Player} player
   */
  _playerInVisionCone(player) {
    if (!player.alive) return false
    const px = player.mesh.position.x
    const pz = player.mesh.position.z
    const ex = this.group.position.x
    const ez = this.group.position.z
    _toPlayer.set(px - ex, 0, pz - ez)
    const distSq = _toPlayer.lengthSq()
    const r = this.visionRange
    if (distSq > r * r || distSq < 1e-8) return false
    this._syncForwardFromRotation()
    _toPlayer.normalize()
    const dot = _toPlayer.dot(_forward)
    return dot >= this._visionCosThreshold
  }

  /**
   * @param {boolean} chasing
   */
  _updateVisionVisual(chasing) {
    const hot = this._playerInVision || chasing
    if (this.type === ENEMY_TYPES.BOSS) {
      const color = this._bossPhase === 1 ? 0x8844ff : this._bossPhase === 2 ? 0xff2266 : 0xff3300
      this.visionMat.color.setHex(color)
      this.visionMat.opacity = this.active ? 0.35 : 0.1
      return
    }
    this.visionMat.color.setHex(hot ? 0xff5533 : this.type === ENEMY_TYPES.CHARGER ? 0xffb14a : 0x4488cc)
    this.visionMat.opacity = this._playerInVision ? 0.42 : chasing ? 0.32 : 0.22
  }

  _applyTypeVisual() {
    if (this.type === ENEMY_TYPES.WATCHER) return
    if (this.type === ENEMY_TYPES.CHARGER) {
      this.visionMat.opacity = 0.2
      return
    }
    this.cube.scale.set(1.15, 1.35, 1.15)
    this.barGroup.position.y += 0.65
    this._applyBossPhaseVisual()
  }

  _applyBossPhaseVisual() {
    if (this.type !== ENEMY_TYPES.BOSS) return
    if (this._bossPhase === 1) {
      this.cube.material.color.setHex(0x7b2cff)
      this.cube.material.emissive.setHex(0x2a0d55)
      this.visionRange = 9.2
      this.visionHalfAngle = Math.PI * 0.45
    } else if (this._bossPhase === 2) {
      this.cube.material.color.setHex(0xd22f7a)
      this.cube.material.emissive.setHex(0x57001f)
      this.visionRange = 10.4
      this.visionHalfAngle = Math.PI * 0.56
      this.cube.scale.set(1.25, 1.5, 1.25)
    } else {
      this.cube.material.color.setHex(0xff3d1a)
      this.cube.material.emissive.setHex(0x5a1300)
      this.visionRange = 12
      this.visionHalfAngle = Math.PI * 0.72
      this.cube.scale.set(1.35, 1.7, 1.35)
    }
    this._visionCosThreshold = Math.cos(this.visionHalfAngle)
  }

  _updateBossPhase() {
    const next = this.hp > this.maxHp * 0.66 ? 1 : this.hp > this.maxHp * 0.33 ? 2 : 3
    if (next !== this._bossPhase) {
      this._bossPhase = next
      this._applyBossPhaseVisual()
      this._bossPatternTimer = 0
    }
  }

  _updateWatcher(dt, player) {
    const px = player.mesh.position.x
    const pz = player.mesh.position.z
    const ex = this.group.position.x
    const ez = this.group.position.z

    this._playerInVision = this._playerInVisionCone(player)
    if (this._playerInVision) this._lostSightTimer = LOST_SIGHT_GRACE
    else if (this._lostSightTimer > 0) this._lostSightTimer -= dt

    const chasing = player.alive && (this._playerInVision || this._lostSightTimer > 0)
    if (this._playerInVision && this._state !== 'chase') {
      this._state = 'alert'
      this._alertTimer = 0.24
    }
    if (!chasing && this._state === 'chase') this._state = 'patrol'

    this._updateVisionVisual(chasing)
    if (this._state === 'alert') {
      this.group.rotation.y = Math.atan2(px - ex, pz - ez)
      this._alertTimer -= dt
      if (this._alertTimer <= 0) this._state = 'chase'
      return
    }

    if (this._state === 'chase' && chasing) {
      const dx = px - ex
      const dz = pz - ez
      if (dx * dx + dz * dz > 1e-8) this.group.rotation.y = Math.atan2(dx, dz)
      this._syncForwardFromRotation()
      _move.copy(_forward).multiplyScalar(this.config.moveChase * dt)
      this.group.position.x += _move.x
      this.group.position.z += _move.z
      return
    }

    if (this._pauseLookTimer > 0) {
      this._pauseLookTimer -= dt
      this._lookTurnChangeTimer -= dt
      if (this._lookTurnChangeTimer <= 0) {
        this._lookTurnChangeTimer = 0.25 + Math.random() * 0.75
        this._lookTurnDir = Math.random() < 0.5 ? -1 : 1
      }
      const turn = (LOOK_TURN_SPEED + Math.random() * LOOK_TURN_JITTER) * this._lookTurnDir
      this.group.rotation.y += turn * dt
      if (this._pauseLookTimer <= 0) {
        this._roamSegmentTimer = ROAM_SEGMENT_MIN + Math.random() * (ROAM_SEGMENT_MAX - ROAM_SEGMENT_MIN)
        this._pickRoamDir()
      }
      return
    }

    this._roamSegmentTimer -= dt
    const dx = this._roamDir.x
    const dz = this._roamDir.z
    if (dx * dx + dz * dz > 1e-8) this.group.rotation.y = Math.atan2(dx, dz)
    _move.copy(this._roamDir).multiplyScalar(this.config.moveRoam * dt)
    this.group.position.add(_move)
    if (this.group.position.distanceToSquared(this.spawn) > 20.25) {
      this._roamDir.copy(this.spawn).sub(this.group.position).setY(0).normalize()
    }
    if (this._roamSegmentTimer <= 0) {
      if (Math.random() < PAUSE_AFTER_MOVE_CHANCE) {
        this._pauseLookTimer = PAUSE_LOOK_MIN + Math.random() * (PAUSE_LOOK_MAX - PAUSE_LOOK_MIN)
        this._lookTurnChangeTimer = 0.2 + Math.random() * 0.4
        this._lookTurnDir = Math.random() < 0.5 ? -1 : 1
      } else {
        this._roamSegmentTimer = ROAM_SEGMENT_MIN + Math.random() * (ROAM_SEGMENT_MAX - ROAM_SEGMENT_MIN)
        this._pickRoamDir()
      }
    }
  }

  _updateCharger(dt, player, enemies) {
    const px = player.mesh.position.x
    const pz = player.mesh.position.z
    const ex = this.group.position.x
    const ez = this.group.position.z
    const cfg = this.config
    const dx = px - ex
    const dz = pz - ez
    const distSq = dx * dx + dz * dz

    this._playerInVision = this._playerInVisionCone(player)
    this._updateVisionVisual(this._state === 'charge' || this._state === 'windup')
    if (this._state === 'idle') {
      if (player.alive && distSq <= cfg.triggerRange * cfg.triggerRange) {
        this._state = 'windup'
        this._chargerTimer = cfg.windup
      }
      return
    }

    if (this._state === 'windup') {
      this.group.rotation.y = Math.atan2(dx, dz)
      this._chargerTimer -= dt
      this.cube.material.emissive.setHex(0x803000)
      if (this._chargerTimer <= 0) {
        this._state = 'charge'
        this._chargeDir.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y)).normalize()
        this._chargerTimer = cfg.chargeDuration
        this._chargerHitIds.clear()
      }
      return
    }

    if (this._state === 'charge') {
      this.group.position.addScaledVector(this._chargeDir, cfg.chargeSpeed * dt)
      this._chargerTimer -= dt
      this.cube.material.emissive.setHex(0xff5a00)
      if (enemies) this._handleChargerEnemyImpact(enemies)
      if (this._chargerTimer <= 0) {
        this._state = 'cooldown'
        this._chargerTimer = cfg.cooldown
      }
      return
    }

    this.cube.material.emissive.setHex(this.config.emissive)
    this._chargerTimer -= dt
    if (this._chargerTimer <= 0) this._state = 'idle'
  }

  _handleChargerEnemyImpact(enemies) {
    for (const other of enemies) {
      if (!other || !other.alive || other.id === this.id) continue
      if (this._chargerHitIds.has(other.id)) continue
      const r = this.getHitRadius() + other.getHitRadius()
      _tmp.copy(other.group.position).sub(this.group.position).setY(0)
      const d2 = _tmp.lengthSq()
      if (d2 > r * r || d2 < 1e-6) continue
      this._chargerHitIds.add(other.id)
      other.takeDamage(Enemy.CHARGER_IMPACT_DAMAGE)
      _tmp.normalize()
      other.group.position.addScaledVector(_tmp, 0.55)
    }
  }

  _updateBoss(dt, player) {
    const px = player.mesh.position.x
    const pz = player.mesh.position.z
    const ex = this.group.position.x
    const ez = this.group.position.z
    const dx = px - ex
    const dz = pz - ez
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (!this.active) {
      const awakeDist = this._bossAwakenRadius
      if (player.alive && this.group.position.distanceTo(player.mesh.position) <= awakeDist) {
        this.active = true
      } else {
        this._updateVisionVisual(false)
        return
      }
    }

    this._updateBossPhase()
    this._updateVisionVisual(true)
    this.group.rotation.y = Math.atan2(dx, dz)
    this._bossPatternTimer -= dt

    if (this._bossPhase === 1) {
      if (dist > 0.01) this.group.position.addScaledVector(_tmp.set(dx, 0, dz).normalize(), dt * 4.2)
      if (this._bossPatternTimer <= 0) {
        this._bossPatternTimer = 1.25
        this.group.position.addScaledVector(_tmp.set(dx, 0, dz).normalize(), 1.3)
      }
      return
    }

    if (this._bossPhase === 2) {
      const side = _tmp.set(-dz, 0, dx).normalize().multiplyScalar(this._bossSpinDir * 3.8 * dt)
      this.group.position.add(side)
      if (dist > 8) this.group.position.addScaledVector(_tmp.set(dx, 0, dz).normalize(), dt * 5.2)
      if (this._bossPatternTimer <= 0) {
        this._bossPatternTimer = 0.95
        this._bossSpinDir *= -1
      }
      return
    }

    if (this._bossPatternTimer <= 0) {
      this._bossPatternTimer = 0.65
      this._chargeDir.set(dx, 0, dz).normalize()
    }
    this.group.position.addScaledVector(this._chargeDir, dt * 9.4)
  }

  /**
   * @param {number} dt
   * @param {import('./player.js').Player} player
   */
  update(dt, player, enemies = null) {
    if (!this.alive) return
    if (this._meleeCooldown > 0) this._meleeCooldown -= dt
    if (!this.active && this.type !== ENEMY_TYPES.BOSS) return
    if (this.type === ENEMY_TYPES.WATCHER) this._updateWatcher(dt, player)
    else if (this.type === ENEMY_TYPES.CHARGER) this._updateCharger(dt, player, enemies)
    else this._updateBoss(dt, player)

    if (player.alive) this._tryMeleeHit(player, player.mesh.position.x, player.mesh.position.z)
  }

  /**
   * @param {import('./player.js').Player} player
   * @param {number} px
   * @param {number} pz
   */
  _tryMeleeHit(player, px, pz) {
    if (this._meleeCooldown > 0) return
    const ex = this.group.position.x
    const ez = this.group.position.z
    const dx = px - ex
    const dz = pz - ez
    const d2 = dx * dx + dz * dz
    const r = this.config.meleeRange || MELEE_RANGE
    if (d2 > r * r) return
    const dmg = this.type === ENEMY_TYPES.BOSS ? Enemy.BOSS_DAMAGE_PER_HIT : Enemy.DAMAGE_PER_HIT
    player.takeDamage(dmg)
    this._meleeCooldown = this.config.meleeCooldown || MELEE_COOLDOWN
  }

  _refreshBarVisual() {
    const t = Math.max(0, this.hp / this.maxHp)
    this.barFill.scale.x = Math.max(0.02, t)
    const c = t > 0.45 ? 0x22dd66 : t > 0.2 ? 0xffaa22 : 0xef4444
    this.barFill.material.color.setHex(c)
    this.barFill.position.x = -(1 - t) * this._barHalfW
  }

  /**
   * @param {number} amount
   */
  takeDamage(amount) {
    if (!this.alive) return
    this.hp -= amount
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
    }
    this._refreshBarVisual()
  }

  /**
   * @param {THREE.Camera} camera
   */
  faceHealthBarToCamera(camera) {
    this.barGroup.quaternion.copy(camera.quaternion)
  }

  /** Pusat kubus untuk tabrakan dengan peluru. */
  getHitCenter() {
    return this._hitCenter.copy(this.group.position)
  }

  getHitRadius() {
    return this.config.hitRadius || Enemy.HIT_RADIUS
  }

  isCharging() {
    return this.type === ENEMY_TYPES.CHARGER && this._state === 'charge'
  }

  dispose() {
    this.scene.remove(this.group)
    this.cube.geometry.dispose()
    this.cube.material.dispose()
    this._visionGeo.dispose()
    this.visionMat.dispose()
    this.barBg.geometry.dispose()
    this.barBg.material.dispose()
    this.barFill.geometry.dispose()
    this.barFill.material.dispose()
  }
}

Enemy.HIT_RADIUS = HIT_RADIUS
/** Damage melee musuh ke player (HP). */
Enemy.DAMAGE_PER_HIT = 20
Enemy.BOSS_DAMAGE_PER_HIT = 30
/** Damage satu peluru player ke musuh. */
Enemy.DAMAGE_FROM_BULLET = 30
Enemy.CHARGER_IMPACT_DAMAGE = 38
Enemy.TILE = TILE
Enemy.TYPE = ENEMY_TYPES
