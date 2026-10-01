# CLAUDE.md

## Project Overview

This project is an **educational motion-controlled endless runner game**.

The player controls an in-game character using their own body movements detected through a webcam.

The core idea is similar to an endless runner game:

- The character continuously runs forward.
- Obstacles appear during gameplay.
- Before an obstacle is reached, the game enters a short slow-motion/question phase.
- The player must answer an educational question.
- The required physical movement depends on the question type and/or answer.
- The webcam detects the player's movement.
- The detected movement controls the game character.

The goal is to combine **education + physical activity + game mechanics**.

---

# Core Gameplay

The game should support these primary player movements:

- `LEFT`
- `CENTER`
- `RIGHT`
- `JUMP`
- `CROUCH`

The game must be able to translate real-world body movement into these game actions.

Example:

```text
Player movement          Game action
------------------------------------
Move left                LEFT
Move to center           CENTER
Move right               RIGHT
Jump                     JUMP
Crouch                    CROUCH
```

---

# Educational Mechanics

The game should present a question before an obstacle.

There are two primary question modes.

## Multiple Choice Side Selection

Example:

```text
Which animal is a mammal?

A. Chicken
B. Cat
C. Fish
```

Answers are mapped to lanes:

```text
A → LEFT
B → CENTER
C → RIGHT
```

The player must physically move to the lane corresponding to their selected answer.

The mapping should be configurable and should not be hard-coded into the game logic.

---

## Movement Questions

Some questions require a physical movement.

Example:

```text
What should you do when you see this obstacle?

A. Jump
B. Crouch
```

Possible mapping:

```text
A → JUMP
B → CROUCH
```

The player must perform the required movement before the obstacle is reached.

---

# Slow Motion

When an obstacle/question sequence begins:

```text
NORMAL GAMEPLAY
       ↓
OBSTACLE WARNING
       ↓
SLOW MOTION
       ↓
QUESTION
       ↓
PLAYER RESPONSE
       ↓
MOVEMENT VALIDATION
       ↓
RESUME NORMAL SPEED
```

Slow motion exists to give the player enough time to:

1. Read the question.
2. Understand the available answers.
3. Perform the required movement.
4. Receive feedback.

Slow motion should be configurable.

Do not hard-code timing values throughout the codebase.

Use a centralized game configuration.

---

# Computer Vision

## Important Requirement

**Do NOT use Python.**

The project must use JavaScript/TypeScript for computer vision.

The initial implementation should run pose estimation on the client device.

Preferred technologies:

- MediaPipe Pose
- MoveNet
- Browser Web APIs
- TypeScript

Do not introduce Python, OpenCV Python, Flask, FastAPI, or a Python inference server unless explicitly requested.

---

# Why Pose Estimation

The project is not primarily interested in detecting whether a person exists.

It needs to understand body movement.

Therefore, use **pose estimation**, not only object detection.

The system should obtain body landmarks such as:

```text
nose
shoulders
elbows
wrists
hips
knees
ankles
```

These landmarks are used to determine:

- horizontal position
- vertical position
- jumping
- crouching
- movement direction

---

# Movement Detection

Movement detection must be implemented as a separate module.

Do NOT mix pose estimation code directly into game logic.

Recommended architecture:

```text
Camera
  ↓
Pose Estimator
  ↓
Pose Landmarks
  ↓
Movement Detector
  ↓
Movement Event
  ↓
Game Controller
```

Example movement event:

```ts
type Movement =
  | "LEFT"
  | "CENTER"
  | "RIGHT"
  | "JUMP"
  | "CROUCH";
```

The game should consume movement events rather than raw pose landmarks.

---

# Movement Detection Rules

## Horizontal Position

Use the player's body center, preferably based on the hip/torso center rather than only the nose.

Normalize horizontal position:

```text
0.0 ───────── 0.33 ───────── 0.66 ───────── 1.0

       LEFT          CENTER          RIGHT
```

The exact thresholds must be configurable.

Avoid using fixed pixel values.

Use normalized coordinates so the system works with different webcam resolutions.

---

## Jump Detection

Jump detection should be based on temporal pose information.

Do not classify a single frame as a jump.

Track the vertical movement of the player's body center over multiple frames.

Conceptually:

```text
NORMAL
  ↓
BODY MOVES UP
  ↓
AIRBORNE
  ↓
BODY RETURNS DOWN
  ↓
JUMP CONFIRMED
```

Jump detection must have configurable:

- minimum displacement
- detection window
- cooldown
- confidence threshold

The system should avoid detecting multiple jumps from one physical jump.

---

## Crouch Detection

Crouch detection should use body geometry and temporal state.

Possible signals:

- hip moves downward
- knee angle decreases
- torso height decreases

Do not depend on a single landmark.

Crouch should be represented as a state:

```text
STANDING
   ↓
LOWERING
   ↓
CROUCHING
   ↓
STANDING
```

Use hysteresis/debouncing to prevent rapid state switching.

---

# Confidence and Tracking

Pose estimation is noisy.

Never assume every frame is valid.

The movement system must handle:

- missing landmarks
- low confidence
- temporary occlusion
- webcam lighting changes
- partial body visibility
- player moving outside the camera frame

Movement detection should expose confidence where useful.

Example:

```ts
interface MovementEvent {
  movement: Movement;
  confidence: number;
  timestamp: number;
}
```

The game should not react to low-confidence movement unless explicitly configured to do so.

---

# Game Architecture

Use clear separation of concerns.

Recommended structure:

```text
src/
├── camera/
│   └── CameraManager
│
├── pose/
│   ├── PoseEstimator
│   └── PoseTypes
│
├── movement/
│   ├── MovementDetector
│   ├── JumpDetector
│   ├── CrouchDetector
│   └── LaneDetector
│
├── game/
│   ├── GameManager
│   ├── Player
│   ├── Obstacle
│   ├── QuestionManager
│   └── GameState
│
├── questions/
│   ├── Question
│   ├── QuestionBank
│   └── AnswerMapping
│
├── ui/
│   ├── QuestionUI
│   ├── ScoreUI
│   └── FeedbackUI
│
└── config/
    └── gameConfig
```

The exact structure may evolve, but responsibilities should remain separated.

---

# Game State

Use explicit game states.

Suggested states:

```ts
type GameState =
  | "READY"
  | "RUNNING"
  | "QUESTION"
  | "SLOW_MOTION"
  | "WAITING_FOR_MOVEMENT"
  | "RESUMING"
  | "GAME_OVER"
  | "PAUSED";
```

Avoid scattering boolean flags such as:

```ts
isQuestion
isSlowMotion
isPaused
isWaiting
```

when a state machine can represent the same concept more reliably.

---

# Question System

Questions must be data-driven.

Do not hard-code questions directly into gameplay code.

Example:

```ts
interface Question {
  id: string;
  text: string;
  type: "LANE" | "MOVEMENT";
  answers: Answer[];
}
```

Example answer:

```ts
interface Answer {
  id: string;
  text: string;
  action: Movement;
  correct: boolean;
}
```

The question system should support future question types without requiring major changes to the game engine.

---

# Answer Validation

The game should distinguish between:

1. Selected answer
2. Required movement
3. Actual movement
4. Correctness

Example:

```text
Question
   ↓
Correct answer = B
   ↓
B maps to CENTER
   ↓
Player moves CENTER
   ↓
Movement detected
   ↓
Correct
```

The game should not assume that a movement is correct merely because the player moved.

---

# Lane System

The initial game should use three lanes:

```text
LEFT
CENTER
RIGHT
```

The lane system should be independent from the physical movement detector.

For example:

```text
MovementDetector
      ↓
"LEFT"
      ↓
LaneController
      ↓
Player moves to LEFT lane
```

This allows the movement detection system to be reused later.

---

# Game Engine

For the initial prototype, prefer:

**Phaser.js**

Reasons:

- 2D game support
- good JavaScript/TypeScript ecosystem
- animation and physics support
- easy integration with browser webcam APIs
- suitable for an endless-runner prototype

Do not introduce a heavy 3D engine unless the project requirements change.

---

# Rendering

The game should run in the browser.

The webcam preview may be shown during development but should be optional in production gameplay.

Provide a debug mode showing:

- webcam image
- pose landmarks
- bounding area/body center
- detected movement
- confidence
- current lane
- current game state
- FPS

Example:

```text
Movement: JUMP
Confidence: 0.91
Lane: CENTER
Game State: WAITING_FOR_MOVEMENT
FPS: 58
```

Debug UI must be disabled or hidden in normal gameplay.

---

# Backend

Node.js may be used as the backend.

However, the game should not require a backend for local pose inference.

Preferred architecture:

```text
Browser
├── Webcam
├── Pose Estimation
├── Movement Detection
└── Game Engine
         │
         │ optional
         ▼
      Node.js
         │
         ├── Questions
         ├── User accounts
         ├── Scores
         ├── Leaderboards
         └── Analytics
```

Do not send raw webcam video to the server unless explicitly required.

Prefer processing webcam frames locally.

---

# Privacy

The webcam feed should remain local by default.

Do not upload or store raw webcam footage.

Only derived data should leave the client when required, such as:

```text
movement
score
question result
game session
```

No raw video should be transmitted without explicit product requirements and user consent.

---

# Performance

The system must prioritize real-time responsiveness.

Target:

```text
Game rendering: ~60 FPS
Pose inference: configurable, preferably 15–30 FPS
```

Pose inference does not necessarily need to run at the same FPS as rendering.

The game loop and AI inference loop should be decoupled when appropriate.

Avoid unnecessary allocations inside per-frame loops.

---

# TypeScript

Use TypeScript rather than plain JavaScript for the main application code.

Prefer explicit types for:

- pose landmarks
- movement events
- questions
- answers
- game states
- obstacles
- configuration

Avoid `any` unless there is a clear technical reason.

---

# Configuration

Put tunable values in configuration.

Example:

```ts
const movementConfig = {
  laneThresholds: {
    left: 0.33,
    right: 0.66,
  },

  jump: {
    minimumDisplacement: 0.08,
    cooldownMs: 700,
  },

  crouch: {
    minimumDurationMs: 300,
  },

  confidence: {
    minimum: 0.6,
  },
};
```

Values are examples only and should be calibrated during development.

Do not spread magic numbers throughout the code.

---

# Development Phases

Build incrementally.

## Phase 1 — Pose Prototype

Goal:

```text
Webcam
  ↓
Pose estimation
  ↓
Display landmarks
```

No game yet.

---

## Phase 2 — Movement Detection

Implement:

```text
LEFT
CENTER
RIGHT
JUMP
CROUCH
```

Display detected movement on screen.

---

## Phase 3 — Basic Runner

Create:

- player
- three lanes
- endless movement
- basic obstacles
- collision detection

No educational system yet.

---

## Phase 4 — Connect Movement to Game

Connect:

```text
LEFT → left lane
CENTER → center lane
RIGHT → right lane
JUMP → player jump
CROUCH → player crouch
```

---

## Phase 5 — Question System

Add:

- question UI
- multiple-choice questions
- answer mapping
- answer validation

---

## Phase 6 — Slow Motion

Add:

- obstacle warning
- slow-motion state
- question phase
- movement response window
- resume gameplay

---

## Phase 7 — Educational Content

Add:

- question categories
- difficulty
- randomized questions
- configurable answer mappings
- scoring

---

## Phase 8 — Polish

Add:

- animations
- sound
- feedback
- tutorial
- accessibility
- calibration
- difficulty settings
- performance optimization

---

# Calibration

Because every webcam and player is different, provide a short calibration phase.

The player should be asked to:

1. Stand normally.
2. Move left.
3. Move right.
4. Jump.
5. Crouch.

Use calibration to establish:

- body center
- normal hip height
- approximate standing height
- movement thresholds

Calibration data should be stored locally when possible.

---

# Important Engineering Principles

## 1. No Python

Do not add Python dependencies.

The primary stack is:

```text
TypeScript
Node.js
Browser APIs
MediaPipe / MoveNet
Phaser
```

---

## 2. Separate Detection From Game Logic

Bad:

```ts
if (hipY < threshold) {
  player.jump();
}
```

inside the pose estimation implementation.

Preferred:

```text
Pose Estimator
      ↓
Jump Detector
      ↓
MovementEvent("JUMP")
      ↓
Game Controller
      ↓
Player.jump()
```

---

## 3. Prefer Events Over Direct Coupling

Movement detection should emit semantic events.

Example:

```ts
movementDetector.on("movement", event => {
  gameController.handleMovement(event);
});
```

This makes the system easier to test.

---

## 4. Test Detection Independently

Movement detection should be testable without starting the entire game.

Provide testable functions such as:

```ts
detectJump(history)
detectCrouch(pose)
detectLane(pose)
```

---

## 5. Avoid Premature Complexity

Start with the smallest working prototype.

Do not initially implement:

- multiplayer
- accounts
- cloud inference
- advanced AI
- 3D graphics
- complicated physics
- large backend architecture

First prove:

```text
Webcam → Pose → Movement → Game
```

Then build outward.

---

# Definition of Done for MVP

The MVP is considered successful when a player can:

1. Open the game in a browser.
2. Allow webcam access.
3. Stand in front of the webcam.
4. Move left/right.
5. Jump.
6. Crouch.
7. See the detected movement.
8. Control the runner character with those movements.
9. Encounter an obstacle.
10. Receive a question.
11. Enter slow motion.
12. Answer using the required physical movement.
13. Receive correct/incorrect feedback.
14. Continue playing.

The entire MVP must run without Python.

---

# Current Priority

The immediate priority is **not** building the complete game.

First build a small technical prototype proving:

```text
WEBCAM
   ↓
POSE ESTIMATION
   ↓
HUMAN BODY LANDMARKS
   ↓
MOVEMENT DETECTION
   ↓
LEFT / CENTER / RIGHT / JUMP / CROUCH
```

Only after this works reliably should the game engine and educational mechanics be built on top.