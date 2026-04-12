import * as THREE from 'three'
import { Player } from './player.js'
import { Enemy } from './enemy.js'

// ── SCENE ─────────────────────────────────────────
const scene = new THREE.Scene()
scene.background = new THREE.Color('#080810')
scene.fog = new THREE.FogExp2(0x080810, 0.04)

// ── CAMERA (top-down) ─────────────────────────────
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  200
)
camera.position.set(0, 18, 12)
camera.lookAt(0, 0, 0)

// ── RENDERER ─────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

// ── LIGHTS ───────────────────────────────────────
const ambient = new THREE.AmbientLight(0x111122, 0.5)
scene.add(ambient)

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2)
dirLight.position.set(5, 20, 5)
dirLight.castShadow = true
dirLight.shadow.mapSize.set(1024, 1024)
scene.add(dirLight)

const accentLight = new THREE.PointLight(0x3d1f78, 2.5, 28)
accentLight.position.set(-4, 4, 2)
scene.add(accentLight)

// ── FLOOR GRID (world-fixed; scrolls in view saat player/kamera bergerak) ──
const gridSize = 120
const gridDivisions = 60
const grid = new THREE.GridHelper(
  gridSize,
  gridDivisions,
  0x3d1f78,
  0x1a1430
)
grid.position.y = 0.002
const gridMat = grid.material
if (Array.isArray(gridMat)) {
  for (const m of gridMat) {
    m.transparent = true
    m.opacity = 0.45
  }
} else {
  gridMat.transparent = true
  gridMat.opacity = 0.45
}
scene.add(grid)

// ── GAME STATE ───────────────────────────────────
const state = {
  phase: 'start',
  roomCount: 0,
  fragments: [],
  keys: {}
}

// ── INPUT ────────────────────────────────────────
function onKeyDown(e) {
  state.keys[e.code] = true
}
function onKeyUp(e) {
  state.keys[e.code] = false
}
window.addEventListener('keydown', onKeyDown)
window.addEventListener('keyup', onKeyUp)

// ── MOUSE → GROUND RAYCAST ───────────────────────
const mouseNdc = new THREE.Vector2()
const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const mouseWorld = new THREE.Vector3()

function updateMouseWorld() {
  raycaster.setFromCamera(mouseNdc, camera)
  raycaster.ray.intersectPlane(groundPlane, mouseWorld)
}

window.addEventListener('mousemove', e => {
  mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1
  mouseNdc.y = -(e.clientY / window.innerHeight) * 2 + 1
  updateMouseWorld()
})

// ── PLAYER ───────────────────────────────────────
const player = new Player(scene)

/** Musuh: kubus merah + health bar. */
const enemies = []

function spawnEnemy(x, z) {
  enemies.push(new Enemy(scene, x, z))
}

/** Spawn musuh acak di arena, menjauh dari player. */
function spawnEnemyRandom(minDistFromPlayer = 10) {
  const range = 32
  for (let k = 0; k < 24; k++) {
    const x = (Math.random() * 2 - 1) * range
    const z = (Math.random() * 2 - 1) * range
    const dx = x - player.mesh.position.x
    const dz = z - player.mesh.position.z
    if (dx * dx + dz * dz >= minDistFromPlayer * minDistFromPlayer) {
      spawnEnemy(x, z)
      return
    }
  }
  spawnEnemy((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24)
}

spawnEnemy(7, 2)
spawnEnemy(-6, 4)
spawnEnemy(1, -8)
spawnEnemy(-3, -5)

const PROJ_RADIUS = 0.1

function resolveProjectileEnemyHits() {
  const hitR = PROJ_RADIUS + Enemy.HIT_RADIUS
  const hitR2 = hitR * hitR

  for (let i = player.projectiles.length - 1; i >= 0; i--) {
    const p = player.projectiles[i]
    const px = p.mesh.position.x
    const py = p.mesh.position.y
    const pz = p.mesh.position.z

    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j]
      if (!e.alive) continue
      const c = e.getHitCenter()
      const dx = px - c.x
      const dy = py - c.y
      const dz = pz - c.z
      if (dx * dx + dy * dy + dz * dz > hitR2) continue

      e.takeDamage(Enemy.DAMAGE_FROM_BULLET)
      player.removeProjectileAt(i)

      if (!e.alive) {
        e.dispose()
        enemies.splice(j, 1)
        spawnEnemyRandom()
      }
      break
    }
  }
}

window.addEventListener('mousedown', e => {
  if (e.button === 0) player.shoot(mouseWorld)
})

// ── LOOP ─────────────────────────────────────────
const clock = new THREE.Clock()
const camOffset = new THREE.Vector3(0, 18, 12)
const camDesired = new THREE.Vector3()

function tick() {
  requestAnimationFrame(tick)
  const dt = clock.getDelta()

  updateMouseWorld()
  player.update(dt, state.keys, mouseWorld)

  for (const e of enemies) {
    if (e.alive) e.update(dt, player)
  }

  resolveProjectileEnemyHits()

  camDesired.copy(player.mesh.position).add(camOffset)
  camera.position.lerp(camDesired, 0.08)
  camera.lookAt(player.mesh.position.x, player.mesh.position.y, player.mesh.position.z)

  player.faceHealthBarToCamera(camera)
  for (const e of enemies) {
    if (e.alive) e.faceHealthBarToCamera(camera)
  }

  renderer.render(scene, camera)
}

tick()

// ── RESIZE ───────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
