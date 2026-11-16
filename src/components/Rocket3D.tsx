import { Canvas, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { MissionStore } from "../lib/store";

// Procedural CloudBurst stand-in: body tube + nosecone + 3 fins. Swap in a glTF
// of the real airframe when provided (Open Question 9).
function RocketModel() {
  return (
    <group>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.35, 0.35, 2.4, 32]} />
        <meshStandardMaterial color="#c9d3e0" metalness={0.3} roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.75, 0]}>
        <coneGeometry args={[0.35, 1.0, 32]} />
        <meshStandardMaterial color="#f0b323" metalness={0.2} roughness={0.4} />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh key={i} position={[0, -0.9, 0]} rotation={[0, (i * 2 * Math.PI) / 3, 0]}>
          <boxGeometry args={[0.02, 0.7, 0.6]} />
          <meshStandardMaterial color="#4aa3ff" />
        </mesh>
      ))}
      {/* nozzle */}
      <mesh position={[0, -1.15, 0]}>
        <cylinderGeometry args={[0.2, 0.28, 0.25, 24]} />
        <meshStandardMaterial color="#3a4150" />
      </mesh>
    </group>
  );
}

// Model length: nozzle y = −1.275 to nose y = +2.25. Centred so it rotates about its middle.
const MID = (2.25 + -1.275) / 2;   // 0.4875
const HALF_LEN = (2.25 - -1.275) / 2; // 1.7625
const RADIUS = 0.35;
const FOV_DEG = 34;
const HALF_TAN = Math.tan(((FOV_DEG / 2) * Math.PI) / 180);
const UP_SMOOTH_S = 0.5; // time constant for smoothing the measured "up" direction
const ZOOM_SMOOTH_S = 0.6; // time constant for the camera easing to a new fit
const VIEW_YAW_SMOOTH_S = 1.0; // time constant for turning the view to keep the lean sideways

function AttitudeRig({
  store, gyroUnits,
}: {
  store: MissionStore;
  gyroUnits: "deg" | "rad";
}) {
  const ref = useRef<THREE.Group>(null);
  const q = useRef(new THREE.Quaternion());
  const tmp = useRef(new THREE.Quaternion());
  // Smoothed "up" from the accelerometer (raw is noisy and made it shake).
  const upSmooth = useRef<THREE.Vector3 | null>(null);
  const axis = useRef(new THREE.Vector3());
  const viewYaw = useRef(0); // display-only turn about vertical (see below)

  useFrame(({ camera, size }, dt) => {
    const g = ref.current;
    if (!g) return;
    const srad = store.srad;
    const state = srad?.flight_state ?? "STANDBY";

    // Body IMU is Z-axial (nose = +Z) and reports the gravity vector (~-1 g along
    // the nose at rest, i.e. accel points "down"). "Up" = -gravity = -accel. Three.js
    // render frame is Y-up, so remap body -> render ((x, y, z)_body -> (x, z, -y)_render)
    // and negate. Accel is m/s^2 (~9.81 at 1 g); at rest upright this is ~(0, +9.81, 0)_render.
    if (srad) {
      const raw = new THREE.Vector3(-(srad.accel.x ?? 0), -(srad.accel.z ?? 0), srad.accel.y ?? 0);
      if (!upSmooth.current) upSmooth.current = raw.clone();
      else upSmooth.current.lerp(raw, 1 - Math.exp(-dt / UP_SMOOTH_S));
    }
    const up = upSmooth.current;

    // Not armed/in flight yet (or no data): calibrate attitude straight from the
    // gravity vector. Pure orientation, no integration -> no drift on the bench,
    // and the model tilts with the airframe as you move it.
    if (!srad || state === "STANDBY") {
      if (up && up.lengthSq() > 1e-6) {
        const target = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0), up.clone().normalize(),
        );
        q.current.slerp(target, Math.min(1, dt * 3));
      } else {
        q.current.slerp(tmp.current.identity(), Math.min(1, dt * 2));
      }
    } else {
      // In flight: integrate the gyro, then correct tilt using gravity.
      const toRad = gyroUnits === "deg" ? Math.PI / 180 : 1;
      const gx = srad.gyro.x ?? 0, gy = srad.gyro.y ?? 0, gz = srad.gyro.z ?? 0;
      const wq = tmp.current.set(
        gx * toRad * dt * 0.5,   // render X
        gz * toRad * dt * 0.5,   // roll about nose -> render Y
        -gy * toRad * dt * 0.5,  // render Z
        1,
      ).normalize();
      q.current.multiply(wq).normalize();
      // Only trust accel as "up" when it's near 1 g.
      const gRatio = up ? up.length() / 9.81 : 0;
      if (up && gRatio > 0.7 && gRatio < 1.3) {
        const measuredUp = up.clone().normalize();   // already = -gravity (up), body frame
        const worldUpInBody = new THREE.Vector3(0, 1, 0).applyQuaternion(q.current.clone().invert());
        // Rotate measuredUp onto worldUpInBody. (Reversed, the model tumbles.)
        const corr = new THREE.Quaternion().setFromUnitVectors(measuredUp, worldUpInBody);
        q.current.multiply(new THREE.Quaternion().slerpQuaternions(new THREE.Quaternion(), corr, 0.02));
        q.current.normalize();
      }
    }
    // Turn the view so the lean is always sideways on screen (display only).
    const nose = axis.current.set(0, 1, 0).applyQuaternion(q.current);
    if (Math.hypot(nose.x, nose.z) > 0.15) {
      const want = Math.atan2(nose.z, nose.x);
      const diff = Math.atan2(Math.sin(want - viewYaw.current), Math.cos(want - viewYaw.current));
      viewYaw.current += diff * (1 - Math.exp(-dt / VIEW_YAW_SMOOTH_S));
    }
    const shown = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 1, 0), viewYaw.current)
      .multiply(q.current);
    g.quaternion.copy(shown);

    // Zoom the camera so the whole rocket fits.
    const a = axis.current.set(0, 1, 0).applyQuaternion(shown);
    const halfH = Math.abs(a.y) * HALF_LEN + RADIUS;
    const halfW = Math.abs(a.x) * HALF_LEN + RADIUS;
    const aspect = size.width / Math.max(1, size.height);
    // Back off a bit more for the end closest to the camera.
    const nearDepth = Math.abs(a.z) * HALF_LEN + RADIUS;
    const fitZ = 1.08 * Math.max(halfH / HALF_TAN, halfW / (HALF_TAN * aspect)) + nearDepth;
    camera.position.z += (Math.max(3, fitZ) - camera.position.z) * (1 - Math.exp(-dt / ZOOM_SMOOTH_S));
  });

  return (
    <group ref={ref}>
      <group position={[0, -MID, 0]}>
        <RocketModel />
      </group>
    </group>
  );
}

// Faint horizon and vertical lines behind the rocket to show its tilt.
const REF_LINES = new Float32Array([-60, 0, -3, 60, 0, -3, 0, -60, -3, 0, 60, -3]);
function ReferenceLines() {
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[REF_LINES, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color="#8a94a6" transparent opacity={0.35} />
    </lineSegments>
  );
}

export function Rocket3D({
  store, gyroUnits = "deg", height = 300, hasData,
}: {
  store: MissionStore;
  gyroUnits?: "deg" | "rad";
  height?: number | string; // "100%" to fill a sized parent
  hasData: boolean;
}) {
  return (
    <div style={{ width: "100%", height, position: "relative" }}>
      <Canvas camera={{ position: [0, 0, 7], fov: FOV_DEG }} dpr={[1, 2]}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 8, 5]} intensity={1.1} />
        <directionalLight position={[-4, 2, -3]} intensity={0.4} color="#5ad1ff" />
        <ReferenceLines />
        <group scale={hasData ? 1 : 0.9}>
          <AttitudeRig store={store} gyroUnits={gyroUnits} />
        </group>
      </Canvas>
      {!hasData && (
        <div style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center",
          justifyContent: "center", pointerEvents: "none",
        }}>
          <span className="empty-note upper">No attitude data</span>
        </div>
      )}
    </div>
  );
}
