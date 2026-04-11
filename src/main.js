import * as THREE from 'three'
import { Player } from './player.js'

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

  camDesired.copy(player.mesh.position).add(camOffset)
  camera.position.lerp(camDesired, 0.08)
  camera.lookAt(player.mesh.position.x, player.mesh.position.y, player.mesh.position.z)

  renderer.render(scene, camera)
}

tick()

// ── RESIZE ───────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})
