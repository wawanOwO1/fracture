import * as THREE from 'three'

const MOVE_SPEED = 8
const DASH_SPEED = 20
const DASH_DURATION = 0.15
const DASH_COOLDOWN = 1.5
const PROJ_SPEED = 20
const PROJ_MAX_DIST = 15

const PLAYER_MAX_HP = 100

const _qInv = new THREE.Quaternion()

export class Player {
  constructor(scene) {
    this.scene = scene
    this.alive = true
    this.isDashing = false
    this.projectiles = []
    this.onDeath = null

    this.maxHp = PLAYER_MAX_HP
    this.hp = PLAYER_MAX_HP

    const geo = new THREE.BoxGeometry(0.6, 1.2, 0.6)
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8e8f0 })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    scene.add(this.mesh)

    const barW = 0.65
    const barH = 0.09
    this.hpBarGroup = new THREE.Group()
    this.hpBarGroup.position.y = 0.82

    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a22,
      depthTest: true,
      transparent: true,
      opacity: 0.95
    })
    this.hpBarBg = new THREE.Mesh(new THREE.PlaneGeometry(barW, barH), bgMat)
    this.hpBarBg.position.z = -0.001

    const fgMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff,
      depthTest: true
    })
    this.hpBarFill = new THREE.Mesh(new THREE.PlaneGeometry(barW, barH), fgMat)
    this.hpBarFill.position.z = 0.001

    this.hpBarGroup.add(this.hpBarBg, this.hpBarFill)
    this.mesh.add(this.hpBarGroup)
    this._hpBarHalfW = barW / 2
    this._refreshHealthBar()

    this._dashTimer = 0
    this._cooldownTimer = 0
    this._dashDir = new THREE.Vector3()
    this._move = new THREE.Vector3()
    this._prevDashKeys = { space: false, shiftL: false, shiftR: false }
  }

  /**
   * @param {number} amount
   */
  takeDamage(amount) {
    if (!this.alive) return
    this.hp -= amount
    if (this.hp <= 0) {
      this.hp = 0
      this.die()
      return
    }
    this._refreshHealthBar()
  }

  _refreshHealthBar() {
    const t = Math.max(0, this.hp / this.maxHp)
    this.hpBarFill.scale.x = Math.max(0.02, t)
    const c = t > 0.45 ? 0x44aaff : t > 0.2 ? 0xffaa22 : 0xef4444
    this.hpBarFill.material.color.setHex(c)
    this.hpBarFill.position.x = -(1 - t) * this._hpBarHalfW
  }

  /**
   * Health bar mengikuti rotasi aim; koreksi agar billboard ke kamera.
   * @param {THREE.Camera} camera
   */
  faceHealthBarToCamera(camera) {
    if (!this.alive) return
    _qInv.copy(this.mesh.quaternion).invert()
    this.hpBarGroup.quaternion.copy(_qInv).multiply(camera.quaternion)
  }

  update(dt, keys, mouseWorld) {
    if (!this.alive) return

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      const step = p.velocity.clone().multiplyScalar(dt)
      p.mesh.position.add(step)
      p.dist += step.length()
      if (p.dist >= PROJ_MAX_DIST) {
        this.scene.remove(p.mesh)
        p.mesh.geometry.dispose()
        p.mesh.material.dispose()
        this.projectiles.splice(i, 1)
      }
    }

    const wantDashEdge =
      (keys['Space'] && !this._prevDashKeys.space) ||
      (keys['ShiftLeft'] && !this._prevDashKeys.shiftL) ||
      (keys['ShiftRight'] && !this._prevDashKeys.shiftR)
    this._prevDashKeys.space = !!keys['Space']
    this._prevDashKeys.shiftL = !!keys['ShiftLeft']
    this._prevDashKeys.shiftR = !!keys['ShiftRight']

    if (this._cooldownTimer > 0) this._cooldownTimer -= dt
    if (this._dashTimer > 0) {
      this._dashTimer -= dt
      this.mesh.position.addScaledVector(this._dashDir, DASH_SPEED * dt)
      if (this._dashTimer <= 0) {
        this.isDashing = false
        this._cooldownTimer = DASH_COOLDOWN
      }
      this._syncRotation(mouseWorld)
      return
    }

    this.isDashing = false

    if (
      wantDashEdge &&
      this._cooldownTimer <= 0 &&
      !this.isDashing
    ) {
      this._fillDashDirection(keys, mouseWorld)
      if (this._dashDir.lengthSq() > 1e-6) {
        this._dashDir.normalize()
        this.isDashing = true
        this._dashTimer = DASH_DURATION
        this.mesh.position.addScaledVector(this._dashDir, DASH_SPEED * dt)
        this._syncRotation(mouseWorld)
        return
      }
    }

    this._move.set(0, 0, 0)
    if (keys['KeyW']) this._move.z -= 1
    if (keys['KeyS']) this._move.z += 1
    if (keys['KeyA']) this._move.x -= 1
    if (keys['KeyD']) this._move.x += 1
    if (this._move.lengthSq() > 0) {
      this._move.normalize().multiplyScalar(MOVE_SPEED * dt)
      this.mesh.position.add(this._move)
    }

    this._syncRotation(mouseWorld)
  }

  _fillDashDirection(keys, mouseWorld) {
    this._dashDir.set(0, 0, 0)
    if (keys['KeyW']) this._dashDir.z -= 1
    if (keys['KeyS']) this._dashDir.z += 1
    if (keys['KeyA']) this._dashDir.x -= 1
    if (keys['KeyD']) this._dashDir.x += 1
    if (this._dashDir.lengthSq() > 1e-6) {
      this._dashDir.normalize()
      return
    }
    const px = this.mesh.position.x
    const pz = this.mesh.position.z
    this._dashDir.set(mouseWorld.x - px, 0, mouseWorld.z - pz)
  }

  _syncRotation(mouseWorld) {
    const dx = mouseWorld.x - this.mesh.position.x
    const dz = mouseWorld.z - this.mesh.position.z
    if (dx * dx + dz * dz < 1e-8) return
    this.mesh.rotation.y = Math.atan2(dx, dz)
  }

  shoot(mouseWorld) {
    if (!this.alive) return
    const px = this.mesh.position.x
    const py = this.mesh.position.y
    const pz = this.mesh.position.z
    const dir = new THREE.Vector3(mouseWorld.x - px, 0, mouseWorld.z - pz)
    if (dir.lengthSq() < 1e-6) return
    dir.normalize()
    const vel = dir.clone().multiplyScalar(PROJ_SPEED)

    const geo = new THREE.SphereGeometry(0.1, 12, 12)
    const mat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0x330000 })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(px, py, pz)
    mesh.castShadow = true
    this.scene.add(mesh)

    this.projectiles.push({
      mesh,
      velocity: vel,
      dist: 0
    })
  }

  /** Hapus peluru indeks `i` (dispose mesh). */
  removeProjectileAt(i) {
    const p = this.projectiles[i]
    if (!p) return
    this.scene.remove(p.mesh)
    p.mesh.geometry.dispose()
    p.mesh.material.dispose()
    this.projectiles.splice(i, 1)
  }

  die() {
    if (!this.alive) return
    this.alive = false
    this.isDashing = false
    this.hp = 0
    this._refreshHealthBar()
    if (typeof this.onDeath === 'function') this.onDeath()
  }
}

Player.MAX_HP = PLAYER_MAX_HP
