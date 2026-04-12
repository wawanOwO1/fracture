import * as THREE from 'three'

const MAX_HP = 100
const CUBE_SIZE = 0.75
const HIT_RADIUS = 0.9

/** Satu sel grid `main.js` (gridSize / gridDivisions). */
const TILE = 2

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

/** Kubus merah: patrol + jeda memandang; deteksi player lewat kerucut penglihatan (bukan radius aggro). */
export class Enemy {
  /**
   * @param {THREE.Scene} scene
   * @param {number} x
   * @param {number} z
   */
  constructor(scene, x, z) {
    this.scene = scene
    this.maxHp = MAX_HP
    this.hp = MAX_HP
    this.alive = true

    const tiles = 1 + Math.floor(Math.random() * 3)
    this.visionRange = (4 + tiles * 1.4) * TILE * 0.55
    this.visionHalfAngle =
      ((26 + Math.random() * 22) * Math.PI) / 180
    this._visionCosThreshold = Math.cos(this.visionHalfAngle)

    this._roamSegmentTimer = ROAM_SEGMENT_MIN + Math.random() * (ROAM_SEGMENT_MAX - ROAM_SEGMENT_MIN)
    this._roamDir = new THREE.Vector3()
    this._pickRoamDir()

    this._pauseLookTimer = 0
    this._lookTurnDir = 1
    this._lookTurnChangeTimer = 0.35 + Math.random() * 0.5

    this._lostSightTimer = 0
    this._playerInVision = false

    this._meleeCooldown = 0

    const half = CUBE_SIZE / 2
    this.group = new THREE.Group()
    this.group.position.set(x, half, z)
    this.group.rotation.y = Math.random() * Math.PI * 2

    const cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)
    const cubeMat = new THREE.MeshStandardMaterial({
      color: 0xcc2222,
      emissive: 0x3a0808
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
    this._barHalfW = barW / 2
    this._hitCenter = new THREE.Vector3()
    this._refreshBarVisual()
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
    this.visionMat.color.setHex(hot ? 0xff5533 : 0x4488cc)
    this.visionMat.opacity = this._playerInVision ? 0.42 : chasing ? 0.32 : 0.22
  }

  /**
   * @param {number} dt
   * @param {import('./player.js').Player} player
   */
  update(dt, player) {
    if (!this.alive) return
    if (this._meleeCooldown > 0) this._meleeCooldown -= dt

    const px = player.mesh.position.x
    const pz = player.mesh.position.z
    const ex = this.group.position.x
    const ez = this.group.position.z

    this._playerInVision = this._playerInVisionCone(player)
    if (this._playerInVision) this._lostSightTimer = LOST_SIGHT_GRACE
    else if (this._lostSightTimer > 0) this._lostSightTimer -= dt

    const chasing =
      player.alive && (this._playerInVision || this._lostSightTimer > 0)

    this._updateVisionVisual(chasing)

    if (chasing) {
      this._pauseLookTimer = 0
      const dx = px - ex
      const dz = pz - ez
      if (dx * dx + dz * dz > 1e-8) {
        this.group.rotation.y = Math.atan2(dx, dz)
      }
      this._syncForwardFromRotation()
      _move.copy(_forward).multiplyScalar(MOVE_CHASE * dt)
      this.group.position.x += _move.x
      this.group.position.z += _move.z
    } else if (this._pauseLookTimer > 0) {
      this._pauseLookTimer -= dt
      this._lookTurnChangeTimer -= dt
      if (this._lookTurnChangeTimer <= 0) {
        this._lookTurnChangeTimer = 0.25 + Math.random() * 0.75
        this._lookTurnDir = Math.random() < 0.5 ? -1 : 1
        if (Math.random() < 0.35) {
          this.group.rotation.y += (Math.random() - 0.5) * 1.1
        }
      }
      const turn =
        (LOOK_TURN_SPEED + Math.random() * LOOK_TURN_JITTER) * this._lookTurnDir
      this.group.rotation.y += turn * dt
      if (this._pauseLookTimer <= 0) {
        this._roamSegmentTimer =
          ROAM_SEGMENT_MIN + Math.random() * (ROAM_SEGMENT_MAX - ROAM_SEGMENT_MIN)
        this._pickRoamDir()
      }
    } else {
      this._roamSegmentTimer -= dt
      const dx = this._roamDir.x
      const dz = this._roamDir.z
      if (dx * dx + dz * dz > 1e-8) {
        this.group.rotation.y = Math.atan2(dx, dz)
      }
      _move.copy(this._roamDir).multiplyScalar(MOVE_ROAM * dt)
      this.group.position.x += _move.x
      this.group.position.z += _move.z

      if (this._roamSegmentTimer <= 0) {
        if (Math.random() < PAUSE_AFTER_MOVE_CHANCE) {
          this._pauseLookTimer =
            PAUSE_LOOK_MIN + Math.random() * (PAUSE_LOOK_MAX - PAUSE_LOOK_MIN)
          this._lookTurnChangeTimer = 0.2 + Math.random() * 0.4
          this._lookTurnDir = Math.random() < 0.5 ? -1 : 1
        } else {
          this._roamSegmentTimer =
            ROAM_SEGMENT_MIN + Math.random() * (ROAM_SEGMENT_MAX - ROAM_SEGMENT_MIN)
          this._pickRoamDir()
        }
      }
    }

    if (player.alive) this._tryMeleeHit(player, px, pz)
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
    const r = MELEE_RANGE
    if (d2 > r * r) return
    player.takeDamage(Enemy.DAMAGE_PER_HIT)
    this._meleeCooldown = MELEE_COOLDOWN
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
/** Damage satu peluru player ke musuh. */
Enemy.DAMAGE_FROM_BULLET = 30
Enemy.TILE = TILE
