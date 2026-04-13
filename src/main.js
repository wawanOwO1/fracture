import * as THREE from 'three'
import { Player } from './player.js'
import { Enemy, pickInitialSpawnXZ } from './enemy.js'

// ── SCENE ─────────────────────────────────────────
const scene = new THREE.Scene()
scene.background = new THREE.Color('#1a1a34')
scene.fog = new THREE.FogExp2(0x1a1a34, 0.026)

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
    m.opacity = 0.58
  }
} else {
  gridMat.transparent = true
  gridMat.opacity = 0.58
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
const bossRoomCenter = new THREE.Vector3(46, 0, -6)
const bossRoomRadius = 15

const bossRoomFloor = new THREE.Mesh(
  new THREE.CircleGeometry(bossRoomRadius, 48),
  new THREE.MeshStandardMaterial({
    color: 0x100b26,
    emissive: 0x1f1238,
    roughness: 0.9,
    metalness: 0.05
  })
)
bossRoomFloor.rotation.x = -Math.PI / 2
bossRoomFloor.position.copy(bossRoomCenter)
bossRoomFloor.position.y = 0.001
scene.add(bossRoomFloor)

const bossRoomRing = new THREE.Mesh(
  new THREE.RingGeometry(bossRoomRadius - 0.25, bossRoomRadius + 0.25, 96),
  new THREE.MeshBasicMaterial({
    color: 0x7a3cff,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide
  })
)
bossRoomRing.rotation.x = -Math.PI / 2
bossRoomRing.position.copy(bossRoomCenter)
bossRoomRing.position.y = 0.012
scene.add(bossRoomRing)

function spawnEnemy(x, z, type = Enemy.TYPE.WATCHER, options = {}) {
  const e = new Enemy(scene, x, z, { ...options, type })
  enemies.push(e)
  return e
}

/** Spawn musuh acak di arena, menjauh dari player. */
function spawnEnemyRandom(minDistFromPlayer = 10) {
  const types = [Enemy.TYPE.WATCHER, Enemy.TYPE.WATCHER, Enemy.TYPE.CHARGER]
  const range = 32
  for (let k = 0; k < 24; k++) {
    const x = (Math.random() * 2 - 1) * range
    const z = (Math.random() * 2 - 1) * range
    const dx = x - player.mesh.position.x
    const dz = z - player.mesh.position.z
    if (dx * dx + dz * dz >= minDistFromPlayer * minDistFromPlayer) {
      const t = types[(Math.random() * types.length) | 0]
      spawnEnemy(x, z, t)
      return
    }
  }
  spawnEnemy((Math.random() - 0.5) * 24, (Math.random() - 0.5) * 24, Enemy.TYPE.WATCHER)
}

for (let i = 0; i < 3; i++) {
  const p = pickInitialSpawnXZ(player.mesh.position.x, player.mesh.position.z)
  spawnEnemy(p.x, p.z, Enemy.TYPE.WATCHER)
}
for (let i = 0; i < 2; i++) {
  const p = pickInitialSpawnXZ(player.mesh.position.x, player.mesh.position.z)
  spawnEnemy(p.x, p.z, Enemy.TYPE.CHARGER)
}

spawnEnemy(
  bossRoomCenter.x,
  bossRoomCenter.z,
  Enemy.TYPE.BOSS,
  { active: false, bossAwakenRadius: bossRoomRadius - 1.2 }
)

/** Radius tabrakan peluru silinder pendek (muzzle). */
const PROJ_RADIUS = 0.08

function resolveProjectileEnemyHits() {
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
      const hitR = PROJ_RADIUS + e.getHitRadius()
      const hitR2 = hitR * hitR
      if (dx * dx + dy * dy + dz * dz > hitR2) continue

      e.takeDamage(Enemy.DAMAGE_FROM_BULLET)
      player.removeProjectileAt(i)

      if (!e.alive) {
        e.dispose()
        enemies.splice(j, 1)
        if (e.type !== Enemy.TYPE.BOSS) {
          spawnEnemyRandom()
        } else {
          state.phase = 'win'
          scene.fog.density = 0.016
          bossRoomRing.material.color.setHex(0x55ffaa)
        }
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
/** Target lookAt di-smooth agar yaw kamera tidak “nyentak” saat player geser horizontal. */
const camLookAt = new THREE.Vector3()
camLookAt.copy(player.mesh.position)
const CAM_LOOK_SMOOTH = 5

function tick() {
  requestAnimationFrame(tick)
  const dt = clock.getDelta()

  updateMouseWorld()
  player.update(dt, state.keys, mouseWorld)

  for (const e of enemies) {
    if (e.alive) e.update(dt, player, enemies)
  }

  resolveProjectileEnemyHits()

  camDesired.copy(player.mesh.position).add(camOffset)
  camera.position.lerp(camDesired, 0.08)
  const lookT = 1 - Math.exp(-CAM_LOOK_SMOOTH * dt)
  camLookAt.lerp(player.mesh.position, lookT)
  camera.lookAt(camLookAt)

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
