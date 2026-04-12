import * as THREE from 'three'

const MAX_HP = 100
const CUBE_SIZE = 0.75
const HIT_RADIUS = 0.42

/** Satu sel grid `main.js` (gridSize / gridDivisions). */
const TILE = 2

const MOVE_CHASE = 4.75
const MOVE_ROAM = 2.65
const ROAM_REPICK = 2.2
const MELEE_RANGE = 0.72
const MELEE_COOLDOWN = 0.85

const _toPlayer = new THREE.Vector3()
const _move = new THREE.Vector3()

/** Kubus merah: roam di bidang XZ, kejar player dalam radius aggro 1–3 tile, melee damage. */
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
    this.aggroRadius = tiles * TILE
    this.aggroRadiusSq = this.aggroRadius * this.aggroRadius

    this._roamTimer = Math.random() * ROAM_REPICK
    this._roamDir = new THREE.Vector3()
    this._pickRoamDir()

    this._meleeCooldown = 0

    const half = CUBE_SIZE / 2
    this.group = new THREE.Group()
    this.group.position.set(x, half, z)

    const cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE)
    const cubeMat = new THREE.MeshStandardMaterial({
      color: 0xcc2222,
      emissive: 0x3a0808
    })
    this.cube = new THREE.Mesh(cubeGeo, cubeMat)
    this.cube.castShadow = true
    this.cube.receiveShadow = true
    this.group.add(this.cube)

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
    this._roamDir.set(Math.cos(a), 0, Math.sin(a))
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

    _toPlayer.set(px - ex, 0, pz - ez)
    const distSq = _toPlayer.lengthSq()
    const chasing = distSq <= this.aggroRadiusSq && distSq > 1e-8

    if (chasing) {
      _toPlayer.normalize()
      _move.copy(_toPlayer).multiplyScalar(MOVE_CHASE * dt)
    } else {
      this._roamTimer -= dt
      if (this._roamTimer <= 0) {
        this._roamTimer = ROAM_REPICK * (0.6 + Math.random() * 0.8)
        this._pickRoamDir()
      }
      _move.copy(this._roamDir).multiplyScalar(MOVE_ROAM * dt)
    }

    this.group.position.x += _move.x
    this.group.position.z += _move.z

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
