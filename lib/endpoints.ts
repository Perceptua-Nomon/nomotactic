/**
 * API endpoint constants — single source of truth for all REST paths.
 */

export const ENDPOINTS = {
  DRIVE: "/api/drive",
  STEER: "/api/steer",
  MOTOR_STOP: "/api/hat/motor/stop",
  MOTOR_SPEED: "/api/hat/motor/speed",
  SERVO_ANGLE: "/api/hat/servo/angle",
  BATTERY: "/api/hat/battery",
  CAMERA_PAN: "/api/camera/pan",
  CAMERA_TILT: "/api/camera/tilt",
  CAMERA_CAPTURE: "/api/camera/capture",
  STREAM_START: "/api/stream/start",
  STREAM_STOP: "/api/stream/stop",
  ULTRASONIC: "/api/sensor/ultrasonic",
  GRAYSCALE: "/api/sensor/grayscale",
  ROUTINE_AVAILABLE: "/api/routines/available",
  ROUTINE_START: "/api/routines/start",
  ROUTINE_HEARTBEAT: "/api/routines/heartbeat",
  ROUTINE_STOP: "/api/routines/stop",
  ROUTINE_STOP_ALL: "/api/routines/stop-all",
  AI_KEY: "/api/ai/key",
  AI_COMMAND: "/api/ai/command",
} as const;
