
const socket = io();
let localStream;
let remoteStream;
let peerConnection;
let isVideoEnabled = false;
let isAudioEnabled = false;
let currentPartner = null;
let currentPartnerUsername = 'Unknown';
let mediaRecorder;
let audioChunks = [];
let isVideoCallActive = false;

// Add mobile-specific optimizations
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// ICE servers configuration
const configuration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// DOM elements
const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendBtn');
const statusDiv = document.getElementById('status');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startVideoBtn = document.getElementById('startVideoBtn');
const toggleAudioBtn = document.getElementById('toggleAudioBtn');
const toggleVideoBtn = document.getElementById('toggleVideoBtn');
const endVideoBtn = document.getElementById('endVideoBtn');
const videoCallPopup = document.getElementById('videoCallPopup');
const acceptVideoCallBtn = document.getElementById('acceptVideoCall');
const rejectVideoCallBtn = document.getElementById('rejectVideoCall');
const callerNameSpan = document.getElementById('callerName');

// Get user preferences
const userPreferences = JSON.parse(localStorage.getItem('soulify_preferences') || '{}');
const username = userPreferences.username || 'Anonymous';

// Send username to server
socket.emit('setUsername', username);

// Mobile optimization: Prevent zoom on input focus
if (isMobile) {
  messageInput.addEventListener('focus', function() {
    document.querySelector('meta[name=viewport]').setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  });
  
  messageInput.addEventListener('blur', function() {
    document.querySelector('meta[name=viewport]').setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
  });
}

// Initialize peer connection
function createPeerConnection() {
  peerConnection = new RTCPeerConnection(configuration);
  
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', event.candidate);
    }
  };
  
  peerConnection.ontrack = (event) => {
    console.log('Received remote stream');
    remoteStream = event.streams[0];
    remoteVideo.srcObject = remoteStream;
    
    // Ensure video plays on mobile
    if (isMobile) {
      remoteVideo.play().catch(e => console.log('Remote video play failed:', e));
    }
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'connected') {
      showStatus('Video call connected', 'success');
    }
  };

  return peerConnection;
}

// Get user media with better error handling
async function getUserMedia() {
  try {
    const constraints = {
      video: {
        width: { ideal: 640, max: 1280 },
        height: { ideal: 480, max: 720 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };

    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
    
    // Ensure local video plays
    if (isMobile) {
      await localVideo.play().catch(e => console.log('Local video play failed:', e));
    }
    
    return localStream;
  } catch (error) {
    console.error('Error accessing media devices:', error);
    showStatus('Camera/microphone access denied', 'error');
    throw error;
  }
}

// Video call request functions
function showVideoCallPopup(callerUsername) {
  callerNameSpan.textContent = callerUsername;
  videoCallPopup.style.display = 'flex';
  
  // Add animation
  const modal = videoCallPopup.querySelector('.video-call-modal');
  modal.style.transform = 'scale(0.8)';
  modal.style.opacity = '0';
  
  setTimeout(() => {
    modal.style.transform = 'scale(1)';
    modal.style.opacity = '1';
    modal.style.transition = 'all 0.3s ease';
  }, 10);
}

function hideVideoCallPopup() {
  const modal = videoCallPopup.querySelector('.video-call-modal');
  modal.style.transform = 'scale(0.8)';
  modal.style.opacity = '0';
  
  setTimeout(() => {
    videoCallPopup.style.display = 'none';
  }, 300);
}

// Start video call
async function startVideoCall() {
  try {
    showStatus('Starting video call...', 'info');
    
    if (!localStream) {
      await getUserMedia();
    }
    
    if (!peerConnection) {
      createPeerConnection();
    }
    
    // Add tracks to peer connection
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    // Request video call from partner
    socket.emit('videoCallRequest');
    showStatus('Video call request sent...', 'info');
    
  } catch (error) {
    console.error('Error starting video call:', error);
    showStatus('Failed to start video call', 'error');
  }
}

// Accept video call
async function acceptVideoCall() {
  try {
    hideVideoCallPopup();
    showStatus('Accepting video call...', 'info');
    
    if (!localStream) {
      await getUserMedia();
    }
    
    if (!peerConnection) {
      createPeerConnection();
    }
    
    // Add tracks to peer connection
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
    
    socket.emit('videoCallAccepted');
    isVideoCallActive = true;
    
  } catch (error) {
    console.error('Error accepting video call:', error);
    showStatus('Failed to accept video call', 'error');
  }
}

// Reject video call
function rejectVideoCall() {
  hideVideoCallPopup();
  socket.emit('videoCallDeclined');
  showStatus(`Video call rejected`, 'info');
}

// End video call
function endVideoCall() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  isVideoCallActive = false;
  
  showStatus('Video call ended', 'info');
}

// Toggle video
function toggleVideo() {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      isVideoEnabled = !isVideoEnabled;
      videoTrack.enabled = isVideoEnabled;
      toggleVideoBtn.textContent = isVideoEnabled ? '📷' : '📷❌';
      socket.emit('toggle-video', isVideoEnabled);
    }
  }
}

// Toggle audio
function toggleAudio() {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      isAudioEnabled = !isAudioEnabled;
      audioTrack.enabled = isAudioEnabled;
      toggleAudioBtn.textContent = isAudioEnabled ? '🎤' : '🎤❌';
      socket.emit('toggle-audio', isAudioEnabled);
    }
  }
}

// Show status message
function showStatus(message, type = 'info') {
  const statusMsg = document.createElement('div');
  statusMsg.className = `status-message ${type}`;
  statusMsg.textContent = message;
  statusDiv.appendChild(statusMsg);
  
  // Auto remove after 3 seconds
  setTimeout(() => {
    if (statusMsg.parentNode) {
      statusMsg.parentNode.removeChild(statusMsg);
    }
  }, 3000);
  
  // Scroll to bottom
  statusDiv.scrollTop = statusDiv.scrollHeight;
}

// Add message to chat
function addMessage(message, isOwn = false, username = '') {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;
  
  const content = document.createElement('div');
  content.className = 'message-content';
  
  if (!isOwn && username) {
    const usernameSpan = document.createElement('div');
    usernameSpan.className = 'username';
    usernameSpan.textContent = username;
    content.appendChild(usernameSpan);
  }
  
  const text = document.createElement('div');
  text.textContent = message;
  content.appendChild(text);
  
  messageDiv.appendChild(content);
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Send message
function sendMessage() {
  const message = messageInput.value.trim();
  if (message) {
    socket.emit('chatMessage', message);
    addMessage(message, true);
    messageInput.value = '';
  }
}

// Event listeners
startVideoBtn.addEventListener('click', startVideoCall);
toggleVideoBtn.addEventListener('click', toggleVideo);
toggleAudioBtn.addEventListener('click', toggleAudio);
endVideoBtn.addEventListener('click', endVideoCall);
acceptVideoCallBtn.addEventListener('click', acceptVideoCall);
rejectVideoCallBtn.addEventListener('click', rejectVideoCall);

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});

// Socket events
socket.on('waiting', () => {
  showStatus('Looking for a stranger...', 'info');
});

socket.on('chatStarted', (data) => {
  currentPartner = data.partnerId;
  currentPartnerUsername = data.partnerUsername || 'Stranger';
  showStatus(`Connected to ${currentPartnerUsername}`, 'success');
});

socket.on('chatMessage', (message) => {
  addMessage(message, false, currentPartnerUsername);
});

socket.on('chatEnded', () => {
  showStatus('Chat ended. Looking for a new partner...', 'info');
  endVideoCall();
  currentPartner = null;
  currentPartnerUsername = 'Unknown';
});

// Video call socket events
socket.on('videoCallRequest', () => {
  showVideoCallPopup(currentPartnerUsername);
});

socket.on('videoCallAccepted', async () => {
  try {
    showStatus('Video call accepted. Connecting...', 'success');
    isVideoCallActive = true;
    
    if (!peerConnection) {
      createPeerConnection();
    }
    
    // Create and send offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', offer);
    
  } catch (error) {
    console.error('Error creating offer:', error);
    showStatus('Failed to connect video call', 'error');
  }
});

socket.on('videoCallDeclined', () => {
  showStatus(`${currentPartnerUsername} declined the video call`, 'info');
  endVideoCall();
});

socket.on('offer', async (offer) => {
  try {
    if (!peerConnection) {
      createPeerConnection();
    }
    
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', answer);
    
  } catch (error) {
    console.error('Error handling offer:', error);
  }
});

socket.on('answer', async (answer) => {
  try {
    await peerConnection.setRemoteDescription(answer);
  } catch (error) {
    console.error('Error handling answer:', error);
  }
});

socket.on('ice-candidate', async (candidate) => {
  try {
    if (peerConnection) {
      await peerConnection.addIceCandidate(candidate);
    }
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
});

socket.on('partner-video-toggle', (enabled) => {
  showStatus(`${currentPartnerUsername} ${enabled ? 'enabled' : 'disabled'} their camera`, 'info');
});

socket.on('partner-audio-toggle', (enabled) => {
  showStatus(`${currentPartnerUsername} ${enabled ? 'enabled' : 'disabled'} their microphone`, 'info');
});

// Start looking for chat partner
socket.emit('startChat');

// Load theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
  document.body.classList.add('dark-mode');
}
