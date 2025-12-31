import { Socket, Presence } from 'phoenix';
import { Whiteboard } from './whiteboard.js';

const pcConfig = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.nextcloud.com:3478' },
  { urls: 'stun:stun.voipbuster.com' },
  { urls: 'stun:stun.voipstunt.com' },
  { urls: 'stun:stun.counterpath.com' },
  { urls: 'stun:stun.services.mozilla.com' }
] };
const localVideoPlayer = document.getElementById('videoplayer-local');
const videoPlayerWrapper = document.getElementById('videoplayer-wrapper');
const peerCount = document.getElementById('viewercount');
const presentationLayout = document.getElementById('presentation-layout');
const mainStage = document.getElementById('main-stage');
const filmstrip = document.getElementById('filmstrip');
const whiteboardContainer = document.getElementById('whiteboard-container');

// NEW: Centralized State
let state = {
  peerId: null,
  sharerId: null,
  activeSharing: null,
  peerVideoElements: {},
  localTracksAdded: false
};

// NEW: Centralized state update function
function setState(newState) {
  const oldState = { ...state };
  state = { ...oldState, ...newState };
  console.log("State changed:", { old: oldState, new: state });
}


let localStream = undefined;
let channel = undefined;
let pc = undefined;
let localTracksAdded = false;
let streamIdToPeerId = {};
let presences = {};
let youtubePlayer = null;
let initialYoutubeState = null;
let peerId = null;
let sharerId = null;
let peerVideoElements = {}; // New map to store video elements per peer
let localScreenShareVideoElement = null; // To hold the local screen share video element
let sharedVideo = {player: null, hls: null};
let whiteboard = null;
let activeSharing = null;

function showError(message) {
  const errorNode = document.getElementById('join-error-message');
  if (errorNode) {
    errorNode.innerText = message;
    errorNode.classList.remove('hidden');
  }
}

function hideError() {
  const errorNode = document.getElementById('join-error-message');
  if (errorNode) {
    errorNode.classList.add('hidden');
    errorNode.innerText = '';
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

function startPresentation(contentElement) {
  presentationLayout.classList.remove('hidden');
  videoPlayerWrapper.classList.add('hidden');
  
  // Move all video elements from videoPlayerWrapper to the filmstrip
  // Include localVideoPlayer if it's not hidden
  Array.from(videoPlayerWrapper.children).forEach(child => {
    if (child.id.startsWith('video-container-') || child.id === 'video-container-local') {
      filmstrip.appendChild(child);
    }
  });

  mainStage.innerHTML = ''; // Clear any previous content
  mainStage.appendChild(contentElement);

  // If the content is the whiteboard, ensure its container is visible
  if (contentElement.id === 'whiteboard-container') {
    whiteboardContainer.classList.remove('hidden');
  }
}

function stopPresentation() {
  presentationLayout.classList.add('hidden');
  videoPlayerWrapper.classList.remove('hidden');

  // If whiteboard was active, move it back to its original parent and hide it
  if (mainStage.contains(whiteboardContainer)) {
    document.querySelector('.flex-1.flex.flex-col').appendChild(whiteboardContainer);
    whiteboardContainer.classList.add('hidden');
  }

  // Move all video elements from filmstrip back to the grid
  Array.from(filmstrip.children).forEach(child => {
    if (child.id.startsWith('video-container-') || child.id === 'video-container-local') {
      videoPlayerWrapper.appendChild(child);
    }
  });

  mainStage.innerHTML = '';
  updateVideoGrid();
}

function applyVideoState(player, state) {
  if (!player || !state) return;

  // YouTube Player
  if (typeof player.seekTo === 'function') {
    console.log("Applying state to YouTube player:", state);
    player.seekTo(state.time, true);
    if (state.state === 1) { // 1 is YT.PlayerState.PLAYING
        player.playVideo();
    } else {
        player.pauseVideo();
    }
  } 
  // Direct <video> Element
  else {
    console.log("Applying state to direct video player:", state);
    player.currentTime = state.time;
    if (state.state === 'play') {
        player.play();
    } else {
        player.pause();
    }
  }
}

async function createPeerConnection() {
  pc = new RTCPeerConnection(pcConfig);

  pc.ontrack = (event) => {
    if (event.track.kind == 'video') {
      if (!event.streams || event.streams.length === 0 || !event.streams[0]) {
        console.warn('Received video track without an associated stream.', event);
        return;
      }
      const streamId = event.streams[0].id;
      const remotePeerId = streamIdToPeerId[streamId];
      const userName = presences[remotePeerId]?.name || 'Guest';

      let videoContainer = peerVideoElements[remotePeerId]?.videoContainer;
      let videoPlayer = peerVideoElements[remotePeerId]?.videoPlayer;
      let nameOverlay = peerVideoElements[remotePeerId]?.nameOverlay;

      if (!videoContainer) {
        console.log(`Creating new video element for peer ${remotePeerId}`);
        videoContainer = document.createElement('div');
        videoContainer.id = `video-container-${remotePeerId}`;
        videoContainer.className = 'relative';

        videoPlayer = document.createElement('video');
        videoPlayer.autoplay = true;
        videoPlayer.playsInline = true;
        videoPlayer.className = 'rounded-xl w-full h-full object-cover';
        videoPlayer.id = `video-player-${remotePeerId}`;

        nameOverlay = document.createElement('div');
        nameOverlay.id = `name-overlay-${remotePeerId}`;
        nameOverlay.className = 'absolute bottom-2 left-2 bg-gray-800 bg-opacity-50 text-white px-2 py-1 rounded';
        nameOverlay.innerText = userName;

        videoContainer.appendChild(videoPlayer);
        videoContainer.appendChild(nameOverlay);

        peerVideoElements[remotePeerId] = { videoContainer, videoPlayer, nameOverlay };
      } else {
        console.log(`Updating existing video element for peer ${remotePeerId}`);
      }

      videoPlayer.srcObject = event.streams[0];

      videoPlayer.onloadedmetadata = () => {
        videoPlayer.play().catch(e => console.error("Autoplay failed for remote stream:", e));
      };

      if (activeSharing === 'screen' && remotePeerId === sharerId) {
        startPresentation(videoContainer);
      } else {
        const isPresentationActive = !presentationLayout.classList.contains('hidden');

        if (isPresentationActive) {
          if (!filmstrip.contains(videoContainer)) {
            filmstrip.appendChild(videoContainer);
          }
        } else {
          if (!videoPlayerWrapper.contains(videoContainer)) {
            videoPlayerWrapper.appendChild(videoContainer);
          }
        }
        updateVideoGrid();
      }

      event.track.onended = () => {
        console.log('Track ended: ' + event.track.id);
      };
    } else if (event.track.kind == 'audio') {
      // Handle audio tracks if necessary
    }
  };

  pc.onicegatheringstatechange = () =>
    console.log('Gathering state change: ' + pc.iceGatheringState);

  pc.onconnectionstatechange = () => {
    console.log('Connection state change: ' + pc.connectionState);
    switch (pc.connectionState) {
      case 'connected':
        hideError();
        break;
      case 'disconnected':
        showError('Media connection lost. Attempting to reconnect...');
        break;
      case 'failed':
        showError('Media connection failed. Please refresh to rejoin.');
        // In a more robust implementation, you might try an ICE restart here.
        // pc.restartIce();
        break;
    }
  };

  pc.onicecandidate = (event) => {
    if (event.candidate == null) {
      console.log('Gathering candidates complete');
      return;
    }

    const candidate = JSON.stringify(event.candidate);
    channel.push('ice_candidate', { body: candidate });
  };
}

async function setupLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    setupPreview();
  } catch (error) {
    console.error('Error accessing media devices:', error);
    switch(error.name) {
      case 'NotAllowedError':
        showError('Permissions for camera/microphone denied. Please grant access and refresh.');
        break;
      case 'NotFoundError':
        showError('No camera/microphone found. Please ensure your devices are connected and enabled.');
        break;
      default:
        showError('Could not access webcam and microphone. Please ensure permissions are granted and no other application is using the camera.');
    }
  }
}

function setupPreview() {
  if (localVideoPlayer) {
    localVideoPlayer.srcObject = localStream;
  }
}

async function joinChannel(roomId, name) {
  const socket = new Socket('/socket');
  socket.connect();

  socket.onOpen(() => {
    console.log("Phoenix Socket reconnected.");
    hideError();
    channel.push("webrtc_renegotiate", {});
  });

  socket.onError(() => {
    showError("Could not connect to the server. Attempting to reconnect...");
  });

  channel = socket.channel(`peer:${roomId}`, { name: name });
  whiteboard = new Whiteboard(document.getElementById('whiteboard-canvas'), channel);


  channel.onError(() => {
    showError("Lost connection to the room. Attempting to reconnect...");
  });

  channel.onClose(() => {
    showError("You have been disconnected from the room.");
  });

  channel.on('sdp_offer', async (payload) => {
    console.log('SDP offer received');

    if (!pc) {
      console.warn('Received SDP offer but PeerConnection is null. Skipping.');
      return;
    }

    await pc.setRemoteDescription({ type: 'offer', sdp: payload.body });

    if (!localTracksAdded) {
      console.log('Adding local tracks to peer connection');
      localStream.getTracks().forEach((track) => pc.addTrack(track));
      localTracksAdded = true;
    }

    const sdpAnswer = await pc.createAnswer();
    await pc.setLocalDescription(sdpAnswer);

    console.log('SDP offer applied, forwarding SDP answer');
    channel.push('sdp_answer', { body: sdpAnswer.sdp });
  });

  channel.on('ice_candidate', (payload) => {
    if (!pc) {
      console.warn('Received ICE candidate but PeerConnection is null. Skipping.');
      return;
    }

    const candidate = JSON.parse(payload.body);
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
        const videoContainer = peerVideoElements[id]?.videoContainer;
        if (videoContainer) {
          videoContainer.remove();
          delete peerVideoElements[id];
          updateVideoGrid();
        }
        if(peerCount) peerCount.innerText = Object.keys(presences).length;
      });
    
      channel
        .join()
        .receive('ok', async (resp) => {
          console.log('Joined channel successfully', resp);
          peerId = resp.peer_id;

          if (pc) {
            pc.close();
            pc = null;
            localTracksAdded = false;
          }

          try {
            await createPeerConnection();
          } catch (error) {
            console.error("Failed to create PeerConnection on join:", error);
            return;
          }

          if (localStream && !localTracksAdded) {
            localStream.getTracks().forEach((track) => pc.addTrack(track));
            localTracksAdded = true;
          }
          
          if (resp.shared_video) {
            const video = resp.shared_video;
            const history = resp.whiteboard_history;
            const video_state = resp.video_state;

            if (video.type === 'youtube') {
              initialYoutubeState = video_state;
              channel.trigger('youtube_video_shared', { ...video });
            } else if (video.type === 'direct') {
              channel.trigger('new_direct_video', { ...video, initialState: video_state });
            } else if (video.type === 'screen_share') {
              channel.trigger('screen_share_started', { sharer_id: video.sharer_id });
            } else if (video.type === 'whiteboard') {
              channel.trigger('whiteboard_started', { sharer_id: video.sharer_id, history: history });
            }
          }
        })
        .receive('error', (resp) => {
          console.error('Unable to join the room:', resp);
          socket.disconnect();
    
          const localVideoContainer = document.getElementById('video-container-local');
          if (localVideoContainer) localVideoContainer.remove();
          
          if(localStream) localStream.getTracks().forEach((track) => track.stop());
          localStream = undefined;
    
          showError(`Unable to join the room: ${resp.reason || 'Unknown error'}`);
        });
    
        channel.on('youtube_video_shared', (payload) => {
          sharerId = payload.sharer_id;
          const videoId = payload.video_id;
        
          const wrapper = document.createElement('div');
          wrapper.style.cssText = 'display: flex; justify-content: center; align-items: center; width: 100%; height: 100%;';
        
          const playerDiv = document.createElement('div');
          playerDiv.id = 'youtube-player';
          playerDiv.style.cssText = 'max-width: 100%; max-height: 100%;';
          
          wrapper.appendChild(playerDiv);
          
          const isSharer = peerId === sharerId;
        
          if (!isSharer) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10; display: flex; justify-content: center; align-items: center; background-color: rgba(0,0,0,0.5); color: white; font-size: 1.5rem; cursor: pointer;';
            overlay.innerText = 'Click to play';
            
            overlay.addEventListener('click', () => {
                youtubePlayer.playVideo();
                overlay.style.display = 'none'; // Hide overlay after first play
            }, { once: true });

            wrapper.appendChild(overlay);
          }
        
          startPresentation(wrapper);
        
          youtubePlayer = new YT.Player('youtube-player', {
            videoId: videoId,
            width: '100%',
            height: '100%',
            playerVars: {
              autoplay: 1,
              controls: isSharer ? 1 : 0,
              rel: 0,
              iv_load_policy: 3,
            },
            events: {
              onReady: (event) => {
                event.target.getIframe().style.aspectRatio = '16 / 9';

                if (isSharer) {
                  channel.push('player_state_change', {
                    state: event.target.getPlayerState(),
                    time: event.target.getCurrentTime(),
                  });
                } else if (initialYoutubeState) {
                  applyVideoState(event.target, initialYoutubeState);
                  initialYoutubeState = null;
                }
              },
              onStateChange: (event) => {
                if (isSharer) {
                  channel.push('player_state_change', {
                    state: event.data,
                    time: event.target.getCurrentTime(),
                  });
                }
              },
            },
          });
        
          document.getElementById('open-youtube-modal').classList.add('hidden');
          if (isSharer) {
            document.getElementById('stop-sharing-button').classList.remove('hidden');
          }
        });

    channel.on('player_state_change', (payload) => {
      if (peerId !== sharerId) {
        applyVideoState(youtubePlayer, payload);
      }
    });

    channel.on('new_direct_video', (payload) => {
      sharerId = payload.sharer_id;
      const isSharer = peerId === sharerId;

      const url = payload.url;
      const videoPlayer = document.createElement('video');
      videoPlayer.controls = isSharer;
      videoPlayer.autoplay = true;
      videoPlayer.className = 'w-full h-full object-contain';

      if (isSharer) {
        const sendState = () => {
          channel.push('direct_video_state_change', { state: videoPlayer.paused ? 'pause' : 'play', time: videoPlayer.currentTime });
        };
        videoPlayer.addEventListener('play', sendState);
        videoPlayer.addEventListener('pause', sendState);
        videoPlayer.addEventListener('seeked', sendState);
      }

      if (url.endsWith('.m3u8') && Hls.isSupported()) {
        const hls = new Hls();
        hls.loadSource(url);
        hls.attachMedia(videoPlayer);
        sharedVideo.hls = hls;
      } else {
        videoPlayer.src = url;
      }

      sharedVideo.player = videoPlayer;
      startPresentation(videoPlayer);

      if (payload.initialState) {
        applyVideoState(sharedVideo.player, payload.initialState);
      }

      document.getElementById('open-youtube-modal').classList.add('hidden');
      if (isSharer) {
        document.getElementById('stop-sharing-button').classList.remove('hidden');
      }
    });

    channel.on('direct_video_state_change', (payload) => {
      if (peerId !== sharerId) {
        applyVideoState(sharedVideo.player, payload);
      }
    });

    channel.on('video_share_stopped', () => {
      stopPresentation();
      if (youtubePlayer) {
        youtubePlayer.destroy();
        youtubePlayer = null;
      }
      if (sharedVideo.hls) {
        sharedVideo.hls.destroy();
      }
      sharedVideo = {player: null, hls: null};
      sharerId = null;
      document.getElementById('open-youtube-modal').classList.remove('hidden');
      document.getElementById('stop-sharing-button').classList.add('hidden');
    });

    channel.on('screen_share_started', (payload) => {
      sharerId = payload.sharer_id;
      activeSharing = 'screen';

      const screenShareVideoContainer = peerVideoElements[sharerId]?.videoContainer;
      if (screenShareVideoContainer) {
        startPresentation(screenShareVideoContainer);
      }
    });

    channel.on('screen_share_stopped', () => {
      // Move the sharer's video from the main stage back to the video grid
      const sharerVideoContainer = mainStage.firstChild;
      if (sharerVideoContainer && sharerVideoContainer.id.startsWith('video-container-')) {
        videoPlayerWrapper.appendChild(sharerVideoContainer);
      }

      sharerId = null;
      activeSharing = null;
      stopPresentation();
    });

    channel.on('whiteboard_started', (payload) => {
      sharerId = payload.sharer_id;
      activeSharing = 'whiteboard';
      
      startPresentation(whiteboardContainer);
      whiteboard.init();
      whiteboard.resize();

      if (payload.history) {
        payload.history.forEach(data => whiteboard.draw(data));
      }

      document.getElementById('toggle-whiteboard').classList.add('hidden');
      document.getElementById('toggle-screen-share').classList.add('hidden');
      document.getElementById('open-youtube-modal').classList.add('hidden');
      if (peerId === sharerId) {
        document.getElementById('stop-sharing-button').classList.remove('hidden');
      }
    });

    channel.on('whiteboard_stopped', () => {
      sharerId = null;
      activeSharing = null;
      whiteboard.destroy();
      stopPresentation();
      
      document.getElementById('toggle-whiteboard').classList.remove('hidden');
      document.getElementById('toggle-screen-share').classList.remove('hidden');
      document.getElementById('open-youtube-modal').classList.remove('hidden');
      document.getElementById('stop-sharing-button').classList.add('hidden');
    });

    channel.on('whiteboard_draw', (data) => {
      whiteboard.draw(data);
    });

    channel.on('whiteboard_clear', () => {
      whiteboard.clear();
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
  isScreenSharing: false,
  screenShareStream: null,
  originalVideoTrack: null,

  async mounted() {
    const roomId = this.el.dataset.roomId;
    const name = this.el.dataset.name;
    document.getElementById('name-overlay-local').innerText = name;

    await setupLocalMedia();
    if (!localStream) return;
    
    joinChannel(roomId, name);

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
      if(pc) pc.close();
      if(localStream) localStream.getTracks().forEach((track) => track.stop());
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
    const chatPanel = document.getElementById('chat-panel');
    const toggleChatButton = document.getElementById('toggle-chat');
    const closeChatButton = document.getElementById('close-chat-panel');
    const chatNotificationBadge = document.getElementById('chat-notification-badge');
    let unreadMessages = 0;
    let isChatOpen = false;

    const sendMessage = () => {
      const message = chatInput.value;
      if (message.trim() !== '') {
        channel.push('new_message', { body: message });
        chatInput.value = '';
      }
    };

    const openChat = () => {
      isChatOpen = true;
      chatPanel.classList.remove('translate-x-full');
      chatPanel.classList.remove('md:hidden'); // Ensure chat is visible on larger screens
      if (isMobile()) {
        toggleChatButton.classList.add('hidden'); // Hide toggle button on mobile when chat is open
      }
      unreadMessages = 0;
      chatNotificationBadge.classList.add('hidden');
      chatNotificationBadge.innerText = '';
    };

    const closeChat = () => {
      isChatOpen = false;
      chatPanel.classList.add('translate-x-full');
      chatPanel.classList.add('md:hidden');
      if (isMobile()) {
        toggleChatButton.classList.remove('hidden'); // Show toggle button on mobile when chat is closed
      }
    };

    if (!isMobile()) {
      chatPanel.classList.add('md:hidden');
    }

    sendChatMessage.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (event) => {
      if (event.key === 'Enter') {
        sendMessage();
      }
    });

    toggleChatButton.addEventListener('click', () => {
      if (isChatOpen) {
        closeChat();
      }
      else {
        openChat();
      }
    });
    closeChatButton.addEventListener('click', closeChat);

    // Handle chat visibility on window resize
    window.addEventListener('resize', handleChatVisibility);
    handleChatVisibility();    channel.on('new_message', (payload) => {
      if (!isChatOpen) {
        unreadMessages++;
        chatNotificationBadge.innerText = unreadMessages;
        chatNotificationBadge.classList.remove('hidden');
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
      chatMessages.scrollTop = chatMessages.scrollHeight;
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
    }
}

    // Share Video Logic
    const youtubeUrlInput = document.getElementById('youtube-url-input');
    const shareVideoButton = document.getElementById('share-youtube-video');
    const stopSharingButton = document.getElementById('stop-sharing-button');

    shareVideoButton.addEventListener('click', () => {
      const url = youtubeUrlInput.value;
      const youtubeVideoId = extractYoutubeVideoId(url);

      if (youtubeVideoId) {
        activeSharing = 'youtube';
        channel.push('share_youtube_video', { video_id: youtubeVideoId });
      } else if (url.match(/\.mp4$|\.webm$|\.ogg$/)) {
        activeSharing = 'direct';
        channel.push('share_direct_video', { url: url });
      } else if (url.match(/^https:\/\/www\.heales\.com\/video\//)) {
        activeSharing = 'direct';
        channel.push('share_heales_video', { url: url });
      } else {
        alert('Please enter a valid YouTube, direct video, or Heales video URL.');
      }

      youtubeUrlInput.value = ''; // Clear input
    });

    stopSharingButton.addEventListener('click', () => {
      if (activeSharing === 'screen') {
        this.stopScreenShare();
      } else if (activeSharing === 'whiteboard') {
        this.stopWhiteboard();
      } else if (activeSharing === 'youtube' || activeSharing === 'direct') {
        channel.push('stop_video_share', {});
      }
    });

    document.getElementById('toggle-screen-share').addEventListener('click', () => this.startScreenShare());

    // Whiteboard logic
    document.getElementById('toggle-whiteboard').addEventListener('click', () => {
      if (activeSharing === 'whiteboard') {
        this.stopWhiteboard();
      } else {
        this.startWhiteboard();
      }
    });

    document.getElementById('whiteboard-color-black').addEventListener('click', () => whiteboard.setColor('black'));
    document.getElementById('whiteboard-color-red').addEventListener('click', () => whiteboard.setColor('red'));
    document.getElementById('whiteboard-color-blue').addEventListener('click', () => whiteboard.setColor('blue'));
    document.getElementById('whiteboard-color-green').addEventListener('click', () => whiteboard.setColor('green'));
    document.getElementById('whiteboard-eraser').addEventListener('click', () => whiteboard.setMode('erase'));
    document.getElementById('whiteboard-clear').addEventListener('click', () => {
      whiteboard.clear();
      channel.push('whiteboard_clear', {});
    });
  },

  startWhiteboard() {
    if (sharerId && sharerId !== peerId) {
      alert('Another user is already presenting.');
      return;
    }
    activeSharing = 'whiteboard';
    channel.push('start_whiteboard', {});
  },

  stopWhiteboard() {
    activeSharing = null;
    channel.push('stop_whiteboard', {});
  },

  async startScreenShare() {
    if (sharerId !== null) {
      alert('Another user is already presenting. Please wait for them to finish.');
      return;
    }
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
    await videoSender.replaceTrack(screenTrack);
    this.isScreenSharing = true;
    activeSharing = 'screen';

    channel.push('screen_share_started', { sharer_id: peerId });
    channel.push("webrtc_renegotiate", {});


    // Create a temporary video element for the local screen share
    localScreenShareVideoElement = document.createElement('div'); // Use div as container
    localScreenShareVideoElement.id = `local-screen-share-video-container`; // Give it a unique ID
    localScreenShareVideoElement.className = 'relative w-full h-full';

    const videoPlayer = document.createElement('video');
    videoPlayer.srcObject = this.screenShareStream;
    videoPlayer.autoplay = true;
    videoPlayer.playsInline = true;
    videoPlayer.className = 'w-full h-full object-contain';
    videoPlayer.id = `local-screen-share-video-player`;

    const nameOverlay = document.createElement('div');
    nameOverlay.id = `name-overlay-local-screen-share`;
    nameOverlay.className = 'absolute bottom-2 left-2 bg-gray-800 bg-opacity-50 text-white px-2 py-1 rounded';
    nameOverlay.innerText = "You (Screen Share)";

    localScreenShareVideoElement.appendChild(videoPlayer);
    localScreenShareVideoElement.appendChild(nameOverlay);

    startPresentation(localScreenShareVideoElement); // Pass this temporary element

    document.getElementById('open-youtube-modal').classList.add('hidden');
    document.getElementById('toggle-screen-share').classList.add('hidden');
    document.getElementById('stop-sharing-button').classList.remove('hidden');

    screenTrack.onended = () => {
      this.stopScreenShare();
    };
  },

  async stopScreenShare() {
    if (!this.isScreenSharing) return;

    const videoSender = pc.getSenders().find(s => s.track.kind === 'video');
    if (videoSender) {
      await videoSender.replaceTrack(this.originalVideoTrack);
    }

    this.screenShareStream.getTracks().forEach(track => track.stop());

    this.isScreenSharing = false;
    this.screenShareStream = null;
    this.originalVideoTrack = null;

    channel.push('screen_share_stopped', {});
    // After replacing the track, we must trigger a renegotiation so that other
    // peers are notified of the track change.
    channel.push("webrtc_renegotiate", {});


    // Remove the local screen share video element from mainStage
    if (localScreenShareVideoElement && mainStage.contains(localScreenShareVideoElement)) {
      mainStage.removeChild(localScreenShareVideoElement);
    }
    localScreenShareVideoElement = null; // Clear the reference

    document.getElementById('open-youtube-modal').classList.remove('hidden');
    document.getElementById('toggle-screen-share').classList.remove('hidden');
    document.getElementById('stop-sharing-button').classList.add('hidden');
  }
};