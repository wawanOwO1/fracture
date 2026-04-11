import * as THREE from 'three'

const MOVE_SPEED = 8
const DASH_SPEED = 20
const DASH_DURATION = 0.15
const DASH_COOLDOWN = 1.5
const PROJ_SPEED = 20
const PROJ_MAX_DIST = 15

export class Player {
  constructor(scene) {
    this.scene = scene
    this.alive = true
    this.isDashing = false
    this.projectiles = []
    this.onDeath = null

    const geo = new THREE.BoxGeometry(0.6, 1.2, 0.6)
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8e8f0 })
    this.mesh = new THREE.Mesh(geo, mat)
    this.mesh.castShadow = true
    this.mesh.receiveShadow = true
    scene.add(this.mesh)

    this._dashTimer = 0
    this._cooldownTimer = 0
    this._dashDir = new THREE.Vector3()
    this._move = new THREE.Vector3()
    this._prevDashKeys = { space: false, shiftL: false, shiftR: false }
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

  die() {
    if (!this.alive) return
    this.alive = false
    this.isDashing = false
    if (typeof this.onDeath === 'function') this.onDeath()
  }
}
