import AgoraRTC from "agora-rtc-sdk-ng";
import {
  FaceLandmarker,
  FilesetResolver,
  PoseLandmarker,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

/* ui */
// Toggle the visibility of the Join channel form
export const showOverlayForm = (visible) => {
  const modal = document.getElementById("overlay");
  if (visible) {
    requestAnimationFrame(() => {
      modal.classList.add("show");
    });
  } else {
    modal.classList.remove("show");
  }
};

// Create the user container and video player div
export const createUserContainer = async (uid) => {
  if (document.getElementById(`user-${uid}-container`)) return;
  const containerDiv = document.createElement("div");
  containerDiv.id = `user-${uid}-container`;
  containerDiv.classList.add("user");
  setColors(containerDiv);
  document.getElementById("container").appendChild(containerDiv);
  adjustGrid();
  return containerDiv;
};

// Remove the div when users leave the channel
export const removeUserContainer = async (uid) => {
  const containerDiv = document.getElementById(`user-${uid}-container`);
  if (containerDiv) {
    containerDiv.parentNode.removeChild(containerDiv);
    adjustGrid();
  }
};

// Create and add a new div element with id
export const addVideoDiv = (uid) => {
  const divId = `user-${uid}-video`;
  if (document.getElementById(divId)) return;
  const remoteUserDiv = document.createElement("div");
  remoteUserDiv.id = divId;
  remoteUserDiv.classList.add("remote-video");
  document.getElementById(`user-${uid}-container`).appendChild(remoteUserDiv);
  return remoteUserDiv;
};

// remove div element with id
export const removeVideoDiv = async (uid) => {
  const divId = `user-${uid}-video`;
  const videoDiv = document.getElementById(divId);
  if (videoDiv) {
    videoDiv.remove();
  }
};

// clear container content
export const emptyContainer = async () => {
  const contianer = document.getElementById("container");
  contianer.replaceChildren([]);
  adjustGrid();
};

// Adjust the container grid layout
const adjustGrid = () => {
  const container = document.getElementById("container");
  const divs = container.querySelectorAll(".user");
  const numDivs = divs.length > 0 ? divs.length : 1;
  let cols = Math.ceil(Math.sqrt(numDivs));
  let rows = Math.ceil(numDivs / cols);

  container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
};

const setColors = (div) => {
  const hue = Math.random() * 360;
  const saturation = Math.random() * 100;
  const lightness = Math.random() * 60 + 20;
  div.style.backgroundColor = `hsl(${hue}, ${saturation}%, ${lightness}%)`;

  const complimentHue = (hue + 180) % 360; // % 360으로 수정
  const complimentLightness = lightness < 50 ? 80 : 20;
  div.style.color = `hsl(${complimentHue}, ${saturation}%, ${complimentLightness}%)`;
};

// 스트레칭 피드백 표시
const showStretchFeedback = (feedback) => {
  const feedbackContainer = document.getElementById("feedback");
  feedbackContainer.innerHTML = feedback;

  feedbackContainer.classList.add("show");
  setTimeout(() => {
    feedbackContainer.classList.remove("show");
  }, 2000);
};

// Create the Agora Client
const client = AgoraRTC.createClient({
  codec: "vp9",
  mode: "live",
  role: "host",
});

const localMedia = {
  audio: {
    track: null,
    isActive: false,
  },
  video: {
    track: null,
    isActive: false,
  },
  canvas: {
    track: null,
    isActive: false,
  },
};

// Container for the remote streams
let remoteUsers = {};
let faceLandmarker;
let poseLandmarker;

// Stretching categories
const STRETCH_TYPES = {
  NECK: "neck",
  SHOULDER: "shoulder",
  WRIST: "wrist",
  STAND_UP: "stand_up", // 일어나는 자세
  SIT_DOWN: "sit_down", // 앉는 자세
};

// Variable to hold current stretch
let currentStretch = "";

// 거리 계산 함수
const calculateDistance = (point1, point2) => {
  return Math.sqrt(
    Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2)
  );
};

// 각도 계산 함수
const calculateAngle = (pointA, pointB, pointC) => {
  const AB = calculateDistance(pointA, pointB);
  const BC = calculateDistance(pointB, pointC);
  const AC = calculateDistance(pointA, pointC);
  const angle = Math.acos(
    (Math.pow(AB, 2) + Math.pow(BC, 2) - Math.pow(AC, 2)) / (2 * AB * BC)
  );
  return (angle * 180) / Math.PI; // 라디안 -> 각도 변환
};

// 목 운동을 적절히 수행하는지 여부를 판별하는 함수
const checkNeckStretchWithJaw = (landmarks) => {
  const leftEar = landmarks[7];
  const rightEar = landmarks[8];
  const chin = landmarks[152]; // 턱의 랜드마크
  const nose = landmarks[1]; // 코의 랜드마크

  const neckStretchThreshold = 12; // 각도 임계값 (15도)
  const chinLowerThreshold = 0.1; // 턱 거리 임계값

  // 귀와 코 사이 각도 계산
  const neckAngle = calculateAngle(leftEar, nose, rightEar);

  // 턱과 코 사이의 거리 차이 계산
  const chinToNoseDistance = calculateDistance(chin, nose);

  // 각도와 거리 임계값 비교
  const isNeckStretched = neckAngle < neckStretchThreshold;
  const isChinLowered = chinToNoseDistance > chinLowerThreshold;

  // 조건 중 하나라도 충족하면 True
  return isNeckStretched;
};

// 목 운동을 적절히 수행하는지 여부를 판별하는 함수
const checkNeckStretchWithEyes = (landmarks) => {
  const leftEye = landmarks[159];
  const rightEye = landmarks[386];

  // Calculate the y-coordinate difference between the eyes
  const eyeDifferenceY = leftEye.y - rightEye.y;
  // console.log(eyeDifferenceY);

  // Neck tilt logic: Define a threshold for the y-difference
  const tiltThreshold = 0.05; // Adjust this value as needed
  if (Math.abs(eyeDifferenceY) > tiltThreshold) {
    return true;
  } else {
    return false;
  }
};

// Check if the shoulder stretch is correct
const checkShoulderStretch = (landmarks) => {
  const leftShoulder = landmarks[11];
  const rightShoulder = landmarks[12];
  const shoulderHeightThreshold = 0.05; // Shoulder should lift slightly

  // Check if shoulders are moving up
  if (Math.abs(leftShoulder.y - rightShoulder.y) < shoulderHeightThreshold) {
    return true;
  }
  return false;
};

// Check if wrist is stretched correctly
const checkWristStretch = (landmarks) => {
  const leftWrist = landmarks[15];
  const rightWrist = landmarks[16];
  const wristStretchThreshold = 0.15; // Threshold for wrist angle

  // Check if wrist is stretched forward
  if (Math.abs(leftWrist.y - rightWrist.y) < wristStretchThreshold) {
    return true;
  }
  return false;
};

// Check if the user is standing up
const checkStandingUp = (landmarks) => {
  const leftHip = landmarks[23]; // 왼쪽 엉덩이
  const rightHip = landmarks[24]; // 오른쪽 엉덩이
  const leftKnee = landmarks[25]; // 왼쪽 무릎
  const rightKnee = landmarks[26]; // 오른쪽 무릎

  // Check if hips are above knees
  if (leftHip.y < leftKnee.y && rightHip.y < rightKnee.y) {
    return true;
  }
  return false;
};

// Check if the user is sitting down
const checkSittingDown = (landmarks) => {
  const leftHip = landmarks[23]; // 왼쪽 엉덩이
  const rightHip = landmarks[24]; // 오른쪽 엉덩이
  const leftKnee = landmarks[25]; // 왼쪽 무릎
  const rightKnee = landmarks[26]; // 오른쪽 무릎

  // Check if hips are below knees
  if (leftHip.y > leftKnee.y && rightHip.y > rightKnee.y) {
    return true;
  }
  return false;
};

// Initialize variables for speech recognition
let recognitionActive = false;
let recognitionStarted = false;
let speechData = []; // 사용자 말한 내용을 담을 배열
let speechIndex = 1; // 인덱스를 추적하는 변수

let recognition;

let isRecognizing = false;

const speechSupported = "webkitSpeechRecognition" in window;
if (speechSupported) {
  recognition = new webkitSpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "ko-KR"; // set to Korean for speech recognition
}

// Start/Stop speech recognition
function toggleSpeechRecognition() {
  if (!speechSupported) {
    alert("Web Speech API is not supported in this browser.");
    return;
  }

  if (isRecognizing) {
    recognition.stop();
    isRecognizing = false;
    document.getElementById("speech-toggle").innerText = "대화 시작";
  } else {
    recognition.start();
    isRecognizing = true;
    document.getElementById("speech-toggle").innerText = "대화 중지";
  }
}

// Store only the most recent transcript
let lastRecognizedText = "";

// Handle speech recognition result
recognition.onresult = (event) => {
  let finalTranscript = "";
  for (let i = 0; i < event.results.length; ++i) {
    if (event.results[i].isFinal) {
      finalTranscript += event.results[i][0].transcript;
    }
  }
  const recognizedText = document.getElementById("recognized-text");
  if (recognizedText) {
    recognizedText.innerText = finalTranscript;
  }

  // 텍스트가 확정될 때마다 배열에 추가
  if (finalTranscript.trim()) {
    // gpt
    lastRecognizedText = finalTranscript.trim(); // Keep only the latest text
    // download
    const formattedText = `${speechIndex}. ${finalTranscript.trim()}\n`;
    speechData.push(formattedText);
    speechIndex++; // 인덱스 증가
  }
};

// Error handler
recognition.onerror = (event) => {
  console.error("Speech recognition error detected:", event.error);
  // Handle specific errors
  if (event.error === "aborted") {
    isRecognizing = false;
    document.getElementById("speech-toggle").innerText = "대화 중지";
  }
};

const API_URL = "https://api.openai.com/v1/chat/completions";

// GPT API 호출 함수
async function fetchChatbotResponse(text) {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are an assistant designed to help elderly patients with brain disorders.",
        },
        { role: "user", content: text },
      ],
      max_tokens: 200,
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content.trim(); // 챗봇의 답변
}

// 사용자의 말과 챗봇 답변을 화면에 표시하는 함수
function displayChatbotResponse(userText, chatbotResponse) {
  const userDiv = document.getElementById("recognized-text");
  const chatDiv = document.createElement("div");
  chatDiv.classList.add("chat-response");

  // 사용자 말
  const userTextDiv = document.createElement("div");
  userTextDiv.classList.add("user-text");
  userTextDiv.innerText = `사용자: ${userText}`;
  ㅇ;
  chatDiv.appendChild(userTextDiv);

  // 챗봇의 답변
  const chatbotTextDiv = document.createElement("div");
  chatbotTextDiv.classList.add("chatbot-text");
  chatbotTextDiv.innerText = `챗봇: ${chatbotResponse}`;
  chatDiv.appendChild(chatbotTextDiv);

  // 기존의 'recognized-text' 아래에 새로운 div 추가
  userDiv.appendChild(chatDiv);
}

// Ensure the recognition starts again after it ends
recognition.onend = async () => {
  // Only restart if recognition was not manually stopped
  if (isRecognizing) {
    recognition.start();
  } else {
    if (lastRecognizedText) {
      // Send the latest text to GPT API
      const chatbotResponse = await fetchChatbotResponse(lastRecognizedText);

      if (chatbotResponse) {
        const formattedText = `${speechIndex}. ${chatbotResponse.trim()}\n`;
        speechData.push(formattedText);
        speechIndex++; // 인덱스 증가
      }

      // Display the user text and chatbot response
      displayChatbotResponse(lastRecognizedText, chatbotResponse);
    }
  }
};

// 텍스트 파일로 다운로드하기
function downloadTextFile() {
  const textBlob = new Blob(speechData, { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(textBlob);
  link.download = `${new Date().toLocaleString()}_대화_내역.txt`; // 다운로드할 파일 이름 설정
  link.click();
}

// CSV 파일로 다운로드
function downloadCsvFile() {
  const csvContent =
    "Sender,Text\n" +
    speechData
      .map(
        (text, index) =>
          `${index % 2 === 0 ? "환자" : "늘봄이"},${JSON.stringify(text)}`
      )
      .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${new Date().toLocaleString()}_대화_내역.csv`; // 다운로드할 파일 이름 설정
  link.click();
}

// UI 업데이트 함수
function updateUI() {
  if (isVideoCallActive) {
    speechToggle.hidden = false; // 대화 시작 버튼 보이기
    downloadBtnTxt.hidden = false; // TXT 다운로드 버튼 보이기
    downloadBtnCsv.hidden = false; // CSV 다운로드 버튼 보이기
  } else {
    speechToggle.hidden = true; // 대화 시작 버튼 숨기기
    downloadBtnTxt.hidden = true; // TXT 다운로드 버튼 숨기기
    downloadBtnCsv.hidden = true; // CSV 다운로드 버튼 숨기기
  }
}

// Wait for DOM to load
document.addEventListener("DOMContentLoaded", async () => {
  addAgoraEventListeners();
  addLocalMediaControlListeners();
  const joinform = document.getElementById("join-channel-form");
  joinform.addEventListener("submit", handleJoin);
  showOverlayForm(true);

  // Mediapipe setup
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
    },
    runningMode: "VIDEO",
    numFaces: 1,
  });
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
  });

  // 버튼 이벤트 추가
  document
    .getElementById("speech-toggle")
    .addEventListener("click", toggleSpeechRecognition);
  document
    .getElementById("download-btn")
    .addEventListener("click", downloadTextFile);
  document
    .getElementById("download-btn-csv")
    .addEventListener("click", downloadCsvFile);
});

// User Form Submit Event
const handleJoin = async (event) => {
  event.preventDefault();

  // Initialize devices if not already initialized
  await initDevices();

  // Check if local media tracks are properly initialized
  if (!localMedia.video.track || !localMedia.audio.track) {
    console.error("Media tracks are not initialized.");
    return; // Early exit if tracks are not initialized
  }

  const dimmer = document.getElementById("dimmer");
  // Dimmer와 Spinner를 표시
  dimmer.style.display = "flex";

  const localUserContainer = document.getElementById("local-user-container");
  const loadingDiv = document.createElement("div");
  loadingDiv.classList.add("lds-ripple");
  loadingDiv.append(document.createElement("div"));
  localUserContainer.append(loadingDiv);

  const video = document.createElement("video");
  video.setAttribute("webkit-playsinline", "webkit-playsinline");
  video.setAttribute("playsinline", "playsinline");

  // Ensure the video track is valid before using it
  if (localMedia.video.track) {
    video.srcObject = new MediaStream([
      localMedia.video.track.getMediaStreamTrack(),
    ]);
  }

  video.addEventListener("loadeddata", () => {
    video.play();
    initPredictLoop(video);
  });

  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);
  const channelName = params.get("c") ?? generateChannelName();

  const appid = import.meta.env.VITE_AGORA_APP_ID;
  const uid = 0;
  const token = await getRtcToken(uid, channelName, "publisher");
  const localUid = await client.join(appid, channelName, token, uid);

  if (!params.has("c")) {
    url.searchParams.set("c", channelName);
    window.history.pushState({}, "", url);
  }

  console.log(`joinedChannel with uid: ${localUid}`);

  localMedia.canvas.isActive = true;
  await client.publish([localMedia.audio.track, localMedia.video.track]);
  showOverlayForm(false);

  const channelInput = document.getElementById("form-rpm-url");
  const channelNameDisplay = document.getElementById("channel-name");

  document.getElementById("local-media-controls").style.display = "flex";
  document.getElementById("local-user-container").style.display = "block";
  document.getElementById("recognized-text").style.display = "block";
  channelNameDisplay.textContent = `현재 통화중인 채널: ${channelInput.value.trim()}`;
  dimmer.style.display = "none";
};

// Initialize Mediapipe Vision
const initPredictLoop = (video) => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  document.body.appendChild(canvas); // 캔버스를 DOM에 추가합니다.

  const drawingUtils = new DrawingUtils(ctx);

  const predict = async () => {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // 비디오 프레임을 캔버스에 그립니다.

    let startTimeMs = performance.now();

    const startTime = performance.now();
    // 추론 실행 (포즈 랜드마커로 비디오의 프레임을 처리)
    const poseResult = await poseLandmarker.detectForVideo(video, startTimeMs);
    const endTime = performance.now();

    // console.log(`Inference Time: ${endTime - startTime} ms`);

    // 비디오 배경 위에 랜드마크를 그립니다.
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 다시 비디오 프레임을 그려서 배경을 유지합니다.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (poseResult.landmarks && poseResult.landmarks.length > 0) {
      for (const landmarks of poseResult.landmarks) {
        drawingUtils.drawLandmarks(landmarks, {
          radius: (data) => DrawingUtils.lerp(data.from.z, -0.15, 0.1, 5, 1),
        });
        drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS);

        if (checkShoulderStretch(landmarks)) {
          showStretchFeedback("Neck Stretching good!");
        } else if (checkWristStretch(landmarks)) {
          showStretchFeedback("Wrist Stretching good!");
        } else {
          showStretchFeedback("Keep Working!");
        }

        // 자세 체크
        if (checkStandingUp(landmarks)) {
          showStretchFeedback("You're standing up!");
          // currentStretch = STRETCH_TYPES.STAND_UP; // 현재 스트레칭 상태 업데이트
        } else if (checkSittingDown(landmarks)) {
          showStretchFeedback("You're sitting down!");
          // currentStretch = STRETCH_TYPES.SIT_DOWN; // 현재 스트레칭 상태 업데이트
        } else {
          showStretchFeedback("Keep Working!");
        }
      }
    }

    ctx.restore();

    // face landmark

    const results = await faceLandmarker.detectForVideo(video, Date.now());

    if (results.faceLandmarks && results.faceLandmarks[0]) {
      const landmarks = results.faceLandmarks[0];
      if (checkNeckStretchWithEyes(landmarks)) {
        showStretchFeedback("목 스트레칭을 잘하고 계시네요!");
      } else {
        showStretchFeedback("기다리고 있어요...");
      }
    }
    //  console.log(results.faceLandmarks[0], "hi????????");

    // Function to draw the detected face landmarks on the canvas
    const drawLandmarks = (landmarks, ctx, color) => {
      ctx.fillStyle = color; // Set the color for the landmarks
      ctx.lineWidth = 1; // Set the line width for drawing

      // Loop through each landmark and draw a point on the canvas
      landmarks.forEach((landmark) => {
        const x = landmark.x * canvas.width; // Scale x-coordinate to canvas width
        const y = landmark.y * canvas.height; // Scale y-coordinate to canvas height
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, 1 * Math.PI); // Draw a small circle at the landmark position
        ctx.fill(); // Fill the circle with the specified color
      });
    };

    // If landmarks are detected, draw them on the canvas
    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
      results.faceLandmarks.forEach((landmarks) => {
        // console.log("Detected landmarks:", landmarks);
        drawLandmarks(landmarks, ctx, "#ffffff"); // Draw the landmarks in white
      });
    } else {
      console.log("No landmarks detected in this frame.");
    }

    requestAnimationFrame(predict); // 다음 프레임을 요청합니다.
  };

  requestAnimationFrame(predict); // 예측 루프를 시작합니다.
};

// Initialize mic and camera devices using Agora
const initDevices = async (audioConfig, cameraConfig) => {
  if (!localMedia.audio.track && !localMedia.video.track) {
    // Create audio and video tracks using AgoraRTC SDK
    [localMedia.audio.track, localMedia.video.track] =
      await AgoraRTC.createMicrophoneAndCameraTracks({
        audio: audioConfig,
        video: cameraConfig,
      });
  }

  localMedia.audio.isActive = true;
  localMedia.video.isActive = true;
};

// Add Agora Event Listeners
const addAgoraEventListeners = () => {
  client.on("user-joined", handleRemoteUserJoined);
  client.on("user-left", handleRemoteUserLeft);
  client.on("user-published", handleRemoteUserPublished);
  client.on("user-unpublished", handleRemoteUserUnpublished);
};

// New remote users join the channel
const handleRemoteUserJoined = async (user) => {
  const uid = user.uid;
  remoteUsers[uid] = user;
  await createUserContainer(uid);
};

// Remote user leaves the channel
const handleRemoteUserLeft = async (user, reason) => {
  const uid = user.uid;
  delete remoteUsers[uid];
  await removeUserContainer(uid);
};

// Remote user publishes a track (audio or video)
const handleRemoteUserPublished = async (user, mediaType) => {
  const uid = user.uid;
  await client.subscribe(user, mediaType);
  if (mediaType === "video") {
    addVideoDiv(uid);
    user.videoTrack.play(`user-${uid}-video`);
  } else if (mediaType === "audio") {
    user.audioTrack.play();
  }
};

// Remote user unpublishes a track (audio or video)
const handleRemoteUserUnpublished = async (user, mediaType) => {
  const uid = user.uid;
  if (mediaType === "video") {
    removeVideoDiv(uid);
  }
};

// Add local media control listeners
const addLocalMediaControlListeners = () => {
  const micToggleBtn = document.getElementById("mic-toggle");
  const videoToggleBtn = document.getElementById("video-toggle");
  const leaveChannelBtn = document.getElementById("leave-channel");

  micToggleBtn.addEventListener("click", handleMicToggle);
  videoToggleBtn.addEventListener("click", handleVideoToggle);
  leaveChannelBtn.addEventListener("click", handleLeaveChannel);
};

const handleMicToggle = async (event) => {
  const isTrackActive = localMedia.audio.isActive;
  await muteTrack(localMedia.audio.track, isTrackActive, event.target);
  localMedia.audio.isActive = !isTrackActive;

  const micToggleBtn = document.getElementById("mic-toggle");
  micToggleBtn.textContent = `마이크 ${isTrackActive ? "켜기" : "끄기"}`;
};

// Handle mute/unmute of audio and video tracks
const handleVideoToggle = async (event) => {
  const isTrackActive = localMedia.video.isActive;
  await muteTrack(localMedia.video.track, isTrackActive, event.target);
  localMedia.video.isActive = !isTrackActive;

  const videoToggleBtn = document.getElementById("video-toggle");
  videoToggleBtn.textContent = `비디오 ${isTrackActive ? "켜기" : "끄기"}`;
};

const handleLeaveChannel = async () => {
  await client.leave();
  console.log("User left the channel");
  for (const uid in remoteUsers) {
    await removeUserContainer(uid);
  }
  remoteUsers = {};
  showOverlayForm(true);
  document.getElementById("local-media-controls").style.display = "none";
  window.location.reload();
};

// Mute or unmute the media track
const muteTrack = async (track, isTrackActive, element) => {
  if (isTrackActive) {
    await track.setMuted(true);
    element.classList.add("muted");
  } else {
    await track.setMuted(false);
    element.classList.remove("muted");
  }
};

// Utility function to generate a random channel name
const generateChannelName = () => {
  return `channel-${Math.floor(Math.random() * 10000)}`;
};

const getRtcToken = async (uid, channelName, role, expiration = 3600) => {
  // Token-Server using: AgoraIO-Community/agora-token-service
  const tokenServerURL =
    import.meta.env.VITE_AGORA_TOKEN_SERVER_URL + "/getToken";
  const tokenRequest = {
    tokenType: "rtc",
    channel: channelName,
    uid: `${uid}`,
    role: role,
    expire: expiration, // optional: expiration time in seconds (default: 3600)
  };

  try {
    const tokenFetchResposne = await fetch(tokenServerURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tokenRequest),
    });
    const data = await tokenFetchResposne.json();
    return data.token;
  } catch (error) {
    console.log(`fetch error: ${error}`);
  }
};
