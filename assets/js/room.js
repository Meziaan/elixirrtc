import { Socket, Presence } from 'phoenix';

const localVideoPlayer = document.getElementById('videoplayer-local');
const videoPlayerWrapper = document.getElementById('videoplayer-wrapper');
const peerCount = document.getElementById('viewercount');
const presentationLayout = document.getElementById('presentation-layout');
const mainStage = document.getElementById('main-stage');
const filmstrip = document.getElementById('filmstrip');

if (!localVideoPlayer || !videoPlayerWrapper || !peerCount || !presentationLayout || !mainStage || !filmstrip) {
  throw new Error('Critical UI elements are missing from the DOM. Aborting script.');
}

let localStream = undefined;
let channel = undefined;
let pc = undefined;
let localTracksAdded = false;
let streamIdToPeerId = {};
let presences = {};
let youtubePlayer = null;
let screenSharerId = null;

const AppState = {
  isChatOpen: false,
  unreadMessages: 0,
  presentationMode: 'none',
  activeSharer: { name: null, id: null },
  get isPresenting() {
    return this.presentationMode !== 'none';
  },
};

// New function to display error messages
function displayErrorMessage(message) {
  const errorNode = document.getElementById('global-error-message');
  if (errorNode) {
    errorNode.innerText = message;
    errorNode.classList.remove('hidden'); // Assuming 'hidden' class hides it
    // Optionally, hide after a few seconds
    setTimeout(() => {
      errorNode.classList.add('hidden');
    }, 5000);
  } else {
    console.error('UI Error:', message);
    // Fallback to alert if no dedicated error element is found
    alert(message);
  }
}

function loadYoutubeAPI() {
  const tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  const firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
}

window.onYouTubeIframeAPIReady = () => {};

function extractYoutubeVideoId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
  const match = url.match(regex);
  return (match && match[1]) ? match[1] : null;
}

async function createPeerConnection() {
  try {
    const resp = await fetch('/api/ice_servers');
    if (!resp.ok) {
      throw new Error(`Failed to fetch ICE servers: ${resp.status}`);
    }
    const config = await resp.json();
    pc = new RTCPeerConnection(config);
  } catch (error) {
    console.error("Error creating peer connection:", error);
    displayErrorMessage("Could not connect to the media server. Please check your network connection and try again.");
    return;
  }

  pc.ontrack = (event) => {
    if (event.track.kind == 'video') {
      const streamId = event.streams[0].id;
      const peerId = streamIdToPeerId[streamId];
      const userName = presences[peerId]?.name || 'Guest';

      console.log(`Creating new video element for peer ${peerId}`);

      const videoContainer = document.createElement('div');
      videoContainer.id = `video-container-${peerId}`;
      videoContainer.className = 'relative';

      const videoPlayer = document.createElement('video');
      videoPlayer.srcObject = event.streams[0];
      videoPlayer.autoplay = true;
      videoPlayer.playsInline = true;
      videoPlayer.className = 'rounded-xl w-full h-full object-cover';
      videoPlayer.id = `video-player-${peerId}`;

      const nameOverlay = document.createElement('div');
      nameOverlay.id = `name-overlay-${peerId}`;
      nameOverlay.className = 'absolute bottom-2 left-2 bg-gray-800 bg-opacity-50 text-white px-2 py-1 rounded';
      nameOverlay.innerText = userName;

      videoContainer.appendChild(videoPlayer);
      videoContainer.appendChild(nameOverlay);
      videoPlayerWrapper.appendChild(videoContainer);
      updateVideoGrid();

      event.track.onended = (_) => {
        console.log('Track ended: ' + event.track.id);
        videoPlayerWrapper.removeChild(videoContainer);
        updateVideoGrid();
      };
    } else {
      console.log('New audio track added');
    }
  };

  pc.onicegatheringstatechange = () =>
    console.log('Gathering state change: ' + pc.iceGatheringState);

  pc.onconnectionstatechange = () => {
    console.log('Connection state change: ' + pc.connectionState);
    switch (pc.connectionState) {
      case 'disconnected':
        console.warn('Peer connection disconnected. The browser will try to reconnect.');
        break;
      case 'failed':
        console.error('Peer connection failed. Restarting ICE to try to recover.');
        pc.restartIce();
        break;
      case 'closed':
        console.error('Peer connection closed.');
        // In a real-world app, you'd likely want to trigger a full reconnect here.
        break;
    }
  };
  pc.onicecandidate = (event) => {
    if (event.candidate == null) {
      console.log('Gathering candidates complete');
      return;
    }

    const candidate = JSON.stringify(event.candidate);
    console.log('Sending ICE candidate: ' + candidate);
    channel.push('ice_candidate', { body: candidate });
  };
}

async function setupLocalMedia() {
  console.log('Setting up local media stream');
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    console.log('Successfully obtained local media stream:', localStream);
    setupPreview();
  } catch (error) {
    console.error('Error accessing media devices:', error);
    displayErrorMessage('Could not access webcam and microphone. Please ensure permissions are granted and no other application is using the camera.');
  }
}

function setupPreview() {
  console.log('Setting up local video preview.');
  if (localVideoPlayer) {
    console.log('localVideoPlayer element found:', localVideoPlayer);
    localVideoPlayer.srcObject = localStream;
    console.log('localVideoPlayer.srcObject set to:', localVideoPlayer.srcObject);
    if (!localStream) {
      console.error('localStream is not set when trying to set up preview.');
    }
  } else {
    console.error('localVideoPlayer element not found.');
  }
}

async function joinChannel(roomId, name, token) {
  const socket = new Socket('/socket');
  socket.connect();
  channel = socket.channel(`peer:${roomId}`, { name: name, token: token });

  const reconnectionStatus = document.getElementById('reconnection-status');

  const reconnectChannel = () => {
    console.log('Attempting to reconnect Phoenix channel...');
    if (reconnectionStatus) {
      reconnectionStatus.innerText = 'Reconnecting...';
      reconnectionStatus.classList.remove('hidden');
    }
    socket.disconnect(); // Disconnect existing socket to ensure a clean reconnect
    socket.connect();
    channel = socket.channel(`peer:${roomId}`, { name: name, token: token });
    channel.join()
      .receive('ok', () => {
        console.log('Phoenix channel reconnected successfully!');
        if (reconnectionStatus) {
          reconnectionStatus.classList.add('hidden');
        }
      })
      .receive('error', (resp) => {
        console.error('Phoenix channel reconnection failed:', resp);
        if (reconnectionStatus) {
          reconnectionStatus.innerText = 'Reconnection failed. Retrying...';
        }
        setTimeout(reconnectChannel, 5000); // Retry after 5 seconds
      });
  };

  channel.onError(() => {
    console.error('Phoenix channel error!');
    reconnectChannel();
  });
  channel.onClose(() => {
    console.warn('Phoenix channel closed!');
    reconnectChannel();
  });

  channel.on('sdp_offer', async (payload) => {
    const sdpOffer = payload.body;

    console.log('SDP offer received');

    await pc.setRemoteDescription({ type: 'offer', sdp: sdpOffer });

    if (!localTracksAdded) {
      console.log('Adding local tracks to peer connection');
      localStream.getTracks().forEach((track) => pc.addTrack(track));
      localTracksAdded = true;
    }

    const sdpAnswer = await pc.createAnswer();
    await pc.setLocalDescription(sdpAnswer);

    console.log('SDP offer applied, forwarding SDP answer');
    const answer = pc.localDescription;
    channel.push('sdp_answer', { body: answer.sdp });
  });

  channel.on('ice_candidate', (payload) => {
    const candidate = JSON.parse(payload.body);
    console.log('Received ICE candidate: ' + payload.body);
    pc.addIceCandidate(candidate);
  });

      channel.on('track_mapping', (payload) => {
        streamIdToPeerId[payload.stream_id] = payload.peer_id;
      });
    
      const presence = new Presence(channel);
    
      presence.onSync(() => {
        presences = {};
        presence.list((id, { metas: [user, ..._] }) => {
          presences[id] = user;
        });
    
        for (const [id, user] of Object.entries(presences)) {
          const nameOverlay = document.getElementById(`name-overlay-${id}`);
          if (nameOverlay) {
            nameOverlay.innerText = user.name;
          }
        }
        if(peerCount) peerCount.innerText = Object.keys(presences).length;
      });
    
      presence.onJoin((id, _current, { metas: [user, ..._] }) => {
        presences[id] = user;
        const nameOverlay = document.getElementById(`name-overlay-${id}`);
        if (nameOverlay) {
          nameOverlay.innerText = user.name;
        }
        if(peerCount) peerCount.innerText = Object.keys(presences).length;
      });
    
      presence.onLeave((id, _current, { metas: [user, ..._] }) => {
        delete presences[id];
        const videoContainer = document.getElementById(`video-container-${id}`);
        if (videoContainer) {
          videoPlayerWrapper.removeChild(videoContainer);
          updateVideoGrid();
        }
        if(peerCount) peerCount.innerText = Object.keys(presences).length;
      });
    
      channel
        .join()
        .receive('ok', (resp) => {
          console.log('Joined channel successfully', resp);
          if (resp && resp.shared_video) {
            const video = resp.shared_video;
            if (video.type === 'youtube') {
              channel.trigger('youtube_video_shared', { video_id: video.id, sender: video.sender });
            } else {
              channel.trigger('new_direct_video', { url: video.url, sender: video.sender });
            }
          }
        })
        .receive('error', (resp) => {
          console.error('Unable to join the room:', resp);
          socket.disconnect();
    
          const localVideoContainer = document.getElementById('video-container-local');
          if (localVideoContainer) videoPlayerWrapper.removeChild(localVideoContainer);
          
          console.log(`Closing stream with id: ${localStream.id}`);
          localStream.getTracks().forEach((track) => track.stop());
          localStream = undefined;
    
          const errorNode = document.getElementById('join-error-message');
          errorNode.innerText = 'Unable to join the room';
          if (resp == 'peer_limit_reached') {
            errorNode.innerText +=
              ': Peer limit reached. Try again in a few minutes';
          }
          errorNode.classList.remove('hidden');
        });
    
        channel.on('youtube_video_shared', (payload) => {
          AppState.presentationMode = 'youtube';
          AppState.activeSharer.name = payload.sender;
          updateUI();

          const videoId = payload.video_id;
          const playerDiv = document.createElement('div');
          playerDiv.id = 'youtube-player';
          playerDiv.className = 'w-full h-full';
          
          // Clear main stage and add new player
          mainStage.innerHTML = '';
          mainStage.appendChild(playerDiv);
    
          youtubePlayer = new YT.Player('youtube-player', {
            videoId: videoId,
            playerVars: { autoplay: 1 },
            events: {
              'onReady': (event) => event.target.playVideo(),
            }
          });
        });
    channel.on('new_direct_video', (payload) => {
      AppState.presentationMode = 'direct';
      AppState.activeSharer.name = payload.sender;
      updateUI();

      const url = payload.url;
      const videoPlayer = document.createElement('video');
      videoPlayer.src = url;
      videoPlayer.controls = true;
      videoPlayer.autoplay = true;
      videoPlayer.className = 'w-full h-full object-contain';
      
      mainStage.innerHTML = '';
      mainStage.appendChild(videoPlayer);
    });

    channel.on('video_share_stopped', () => {
      AppState.presentationMode = 'none';
      AppState.activeSharer.name = null;
      AppState.activeSharer.id = null;
      updateUI();

      if (youtubePlayer) {
        youtubePlayer.destroy();
        youtubePlayer = null;
      }
      mainStage.innerHTML = '';
    });

    channel.on('screen_share_started', (payload) => {
      AppState.presentationMode = 'screen';
      AppState.activeSharer.id = payload.peer_id;
      AppState.activeSharer.name = payload.name;
      updateUI();

      const videoContainer = document.getElementById(`video-container-${payload.peer_id}`);
      if (videoContainer) {
        mainStage.innerHTML = '';
        mainStage.appendChild(videoContainer);
      }
    });
}



function updateVideoGrid() {
  const videoCount = videoPlayerWrapper.children.length;

  let columns;
  if (videoCount <= 1) {
    columns = "grid-cols-1";
  } else if (videoCount <= 4) {
    columns = "grid-cols-1 sm:grid-cols-2";
  } else if (videoCount <= 9) {
    columns = "grid-cols-2 sm:grid-cols-3";
  } else {
    columns = "grid-cols-3 sm:grid-cols-4";
  }

  videoPlayerWrapper.className = `w-full h-full grid gap-2 p-2 auto-rows-fr ${columns}`;
}

export const Room = {
  screenShareStream: null,
  originalVideoTrack: null,

  async mounted() {
    const roomId = this.el.dataset.roomId;
    const name = this.el.dataset.name;
    const token = this.el.dataset.token;
    document.getElementById('name-overlay-local').innerText = name;

    await createPeerConnection();
    await setupLocalMedia();
    joinChannel(roomId, name, token);

    loadYoutubeAPI();

    const toggleAudio = document.getElementById('toggle-audio');
    const audioOnIcon = document.getElementById('audio-on-icon');
    const audioOffIcon = document.getElementById('audio-off-icon');
    toggleAudio.addEventListener('click', () => {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
        audioOnIcon.classList.toggle('hidden', !track.enabled);
        audioOffIcon.classList.toggle('hidden', track.enabled);
      });
    });

    const toggleVideo = document.getElementById('toggle-video');
    const videoOnIcon = document.getElementById('video-on-icon');
    const videoOffIcon = document.getElementById('video-off-icon');
    toggleVideo.addEventListener('click', () => {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
        videoOnIcon.classList.toggle('hidden', !track.enabled);
        videoOffIcon.classList.toggle('hidden', track.enabled);
      });
    });

    const leaveRoom = document.getElementById('leave-room');
    leaveRoom.addEventListener('click', () => {
      channel.leave();
      pc.close();
      localStream.getTracks().forEach((track) => track.stop());
      window.location.href = '/';
    });

    const copyLinkButton = document.getElementById('copy-link');
    copyLinkButton.addEventListener('click', () => {
      const copyLinkIcon = copyLinkButton.querySelector('span');
      const urlToCopy = window.location.origin + window.location.pathname;
      navigator.clipboard.writeText(urlToCopy).then(() => {
        copyLinkIcon.className = "hero-check-solid h-6 w-6";
        copyLinkButton.disabled = true;

        setTimeout(() => {
          copyLinkIcon.className = "hero-link-solid h-6 w-6";
          copyLinkButton.disabled = false;
        }, 2000);
      }).catch(err => {
        console.error('Failed to copy URL: ', err);
        alert("Failed to copy link.");
      });
    });

    // Chat
    const chatMessages = document.getElementById('chat-messages');
    const chatInput = document.getElementById('chat-input');
    const sendChatMessage = document.getElementById('send-chat-message');
    const toggleChatButton = document.getElementById('toggle-chat');
    const closeChatButton = document.getElementById('close-chat-panel');

    const sendMessage = () => {
      const message = chatInput.value;
      if (message.trim() !== '') {
        channel.push('new_message', { body: message });
        chatInput.value = '';
      }
    };

    // Initial UI update
    updateUI();

    sendChatMessage.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        sendMessage();
      }
    });

    toggleChatButton.addEventListener('click', () => {
      setChatOpen(!AppState.isChatOpen);
      if (AppState.isChatOpen) {
        // Scroll to bottom when opening
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    });
    closeChatButton.addEventListener('click', () => setChatOpen(false));

    // Handle chat visibility on window resize
    window.addEventListener('resize', updateUI);

    channel.on('new_message', (payload) => {
      if (!AppState.isChatOpen) {
        AppState.unreadMessages++;
        updateUI();
      }

      const messageElement = document.createElement('div');
      messageElement.className = 'flex flex-col mb-2';
  
      const messageHeader = document.createElement('div');
      messageHeader.className = 'flex items-center';
  
      const senderName = document.createElement('span');
      senderName.className = 'font-semibold text-sm';
      senderName.innerText = payload.name;
  
      const messageTimestamp = document.createElement('span');
      messageTimestamp.className = 'ml-2 text-xs text-gray-500';
      messageTimestamp.innerText = new Date(payload.timestamp + 'Z').toLocaleTimeString('en-GB', { timeZone: 'Europe/London' });
  
      messageHeader.appendChild(senderName);
      messageHeader.appendChild(messageTimestamp);
  
      const messageBody = document.createElement('div');
      messageBody.className = 'text-sm';
      messageBody.innerText = payload.body;
  
      messageElement.appendChild(messageHeader);
      messageElement.appendChild(messageBody);
  
      chatMessages.appendChild(messageElement);
      requestAnimationFrame(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
      });
    });

function isMobile() {
  return window.innerWidth <= 768;
}

function handleChatVisibility() {
    const chatContainer = document.getElementById('chat-panel');
    if (!chatContainer) return; // Ensure chatContainer exists

    if (isMobile()) {
        // On mobile, if chat is visible, hide it.
        if (!chatContainer.classList.contains("translate-x-full")) {
            chatContainer.classList.add("translate-x-full");
            // Optionally, remove md:hidden if it was added for mobile
            chatContainer.classList.remove('md:hidden');
        }
    } else {
        // On desktop, we don't automatically show/hide the chat based on window size.
        // Its visibility is controlled by the toggle button.
        // If it's desktop and chat is hidden, we do nothing here.
        // If it's desktop and chat is shown, we do nothing here.
    }
}

function updateUI() {
  const chatPanel = document.getElementById('chat-panel');
  const toggleChatButton = document.getElementById('toggle-chat');
  const chatNotificationBadge = document.getElementById('chat-notification-badge');

  // Chat Panel
  chatPanel.classList.toggle('translate-x-full', !AppState.isChatOpen);
  chatPanel.classList.toggle('md:hidden', !AppState.isChatOpen && !isMobile());

  if (isMobile()) {
    toggleChatButton.classList.toggle('hidden', AppState.isChatOpen);
  } else {
    toggleChatButton.classList.remove('hidden');
  }

  // Chat Badge
  chatNotificationBadge.classList.toggle('hidden', AppState.unreadMessages === 0);
  chatNotificationBadge.innerText = AppState.unreadMessages > 0 ? AppState.unreadMessages : '';

  // Presentation Mode
  presentationLayout.classList.toggle('hidden', !AppState.isPresenting);
  videoPlayerWrapper.classList.toggle('hidden', AppState.isPresenting);

  // Buttons
  const myName = document.getElementById('room').dataset.name;
  const isMyShare = AppState.activeSharer.name === myName;

  const stopSharingButton = document.getElementById('stop-sharing-button');
  const openYoutubeModal = document.getElementById('open-youtube-modal');
  const toggleScreenShare = document.getElementById('toggle-screen-share');

  stopSharingButton.classList.toggle('hidden', !AppState.isPresenting || !isMyShare);
  openYoutubeModal.classList.toggle('hidden', AppState.isPresenting);
  toggleScreenShare.classList.toggle('hidden', AppState.isPresenting);
}

function setChatOpen(isOpen) {
  AppState.isChatOpen = isOpen;
  if (isOpen) {
    AppState.unreadMessages = 0;
  }
  updateUI();
}

    // Share Video Logic
    const youtubeUrlInput = document.getElementById('youtube-url-input');
    const shareVideoButton = document.getElementById('share-youtube-video');
    const stopSharingButton = document.getElementById('stop-sharing-button');

    shareVideoButton.addEventListener('click', () => {
      const url = youtubeUrlInput.value;
      const youtubeVideoId = extractYoutubeVideoId(url);

      if (youtubeVideoId) {
        channel.push('share_youtube_video', { video_id: youtubeVideoId });
      } else if (url.match(/\.mp4$|\.webm$|\.ogg$/)) {
        channel.push('share_direct_video', { url: url });
      } else {
        displayErrorMessage('Please enter a valid YouTube or direct video URL.');
      }

      youtubeUrlInput.value = ''; // Clear input
    });

    stopSharingButton.addEventListener('click', () => {
      if (AppState.presentationMode === 'screen') {
        this.stopScreenShare();
      } else {
        channel.push('stop_video_share', {});
      }
    });

    document.getElementById('toggle-screen-share').addEventListener('click', () => this.startScreenShare());
  },

  async startScreenShare() {
    if (this.isScreenSharing) return;

    try {
      this.screenShareStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    } catch (err) {
      console.error("Error starting screen share:", err);
      return;
    }

    const screenTrack = this.screenShareStream.getVideoTracks()[0];
    const videoSender = pc.getSenders().find(s => s.track.kind === 'video');

    if (!videoSender) {
      console.error("Could not find video sender");
      return;
    }

    this.originalVideoTrack = videoSender.track;
    videoSender.replaceTrack(screenTrack);

    const myName = document.getElementById('room').dataset.name;
    AppState.presentationMode = 'screen';
    AppState.activeSharer.name = myName;
    updateUI();

    const screenVideoElement = document.createElement('video');
    screenVideoElement.srcObject = this.screenShareStream;
    screenVideoElement.autoplay = true;
    screenVideoElement.playsInline = true;
    screenVideoElement.className = 'w-full h-full object-contain';

    const screenVideoContainer = document.createElement('div');
    screenVideoContainer.id = 'local-screen-share-container';
    screenVideoContainer.className = 'w-full h-full bg-black';
    screenVideoContainer.appendChild(screenVideoElement);

    mainStage.innerHTML = '';
    mainStage.appendChild(screenVideoContainer);

    channel.push('start_screen_share', {});

    screenTrack.onended = () => {
      this.stopScreenShare();
    };
  },

  stopScreenShare() {
    if (!this.isScreenSharing) return;

    const videoSender = pc.getSenders().find(s => s.track.kind === 'video');
    if (videoSender) {
      videoSender.replaceTrack(this.originalVideoTrack);
    }

    this.screenShareStream.getTracks().forEach(track => track.stop());

    this.screenShareStream = null;
    this.originalVideoTrack = null;

    channel.push('stop_screen_share', {});

    // The video_share_stopped handler will update the state and UI
  }
};