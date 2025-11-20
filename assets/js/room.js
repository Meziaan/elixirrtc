import { Socket, Presence } from 'phoenix';

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

let localStream = undefined;
let channel = undefined;
let pc = undefined;
let localTracksAdded = false;
let streamIdToPeerId = {};
let presences = {};
let youtubePlayer = null;
let peerId = null;
let sharerId = null;
let peerVideoElements = {}; // New map to store video elements per peer
let localScreenShareVideoElement = null; // To hold the local screen share video element
let sharedVideo = {player: null, hls: null};

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

  mainStage.innerHTML = ''; // Clear any previous content (e.g., YouTube iframe)
  if (contentElement.parentNode) {
    contentElement.parentNode.removeChild(contentElement);
  }
  mainStage.appendChild(contentElement);
}

function stopPresentation() {
  presentationLayout.classList.add('hidden');
  videoPlayerWrapper.classList.remove('hidden');

  // Move all video elements from filmstrip back to the grid
  Array.from(filmstrip.children).forEach(child => {
    if (child.id.startsWith('video-container-') || child.id === 'video-container-local') {
      videoPlayerWrapper.appendChild(child);
    }
  });

  // Move the video element from mainStage back to videoPlayerWrapper if it's a video container
  if (mainStage.firstChild && mainStage.firstChild.id && 
      (mainStage.firstChild.id.startsWith('video-container-') || mainStage.firstChild.id === 'local-screen-share-video-container')) {
    videoPlayerWrapper.appendChild(mainStage.firstChild);
  } else {
    // If it was a YouTube iframe or other non-reusable content, just clear it
    mainStage.innerHTML = '';
  }
  updateVideoGrid();
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

      console.log("pc.ontrack debug:", {
        trackLabel: event.track.label,
        remotePeerId: remotePeerId,
        globalSharerId: sharerId
      });

      if (remotePeerId === sharerId) {
        // This is the active screen share, put it in mainStage
        startPresentation(videoContainer);
        console.log(`Screen share from ${userName} (${remotePeerId}) moved to main stage.`);

      } else {
        // Regular camera feed or inactive screen share, add to videoPlayerWrapper
        // Ensure it's not already in videoPlayerWrapper or filmstrip
        if (!videoPlayerWrapper.contains(videoContainer) && !filmstrip.contains(videoContainer)) {
          videoPlayerWrapper.appendChild(videoContainer);
        }
        updateVideoGrid();
      }

      event.track.onended = (_) => {
        console.log('Track ended: ' + event.track.id);
        // If the ended track was the main stage screen share, stop presentation
        if (remotePeerId === sharerId) {
          stopPresentation();
        }
        // Do NOT remove the container. It will be reused for the next track.
        // The videoPlayer.srcObject will become null or inactive naturally.
        // If a new track arrives for this peer, srcObject will be updated.
        // If the peer leaves, the presence.onLeave handler will remove the container.
      };
    } else if (event.track.kind == 'audio') {
      if (!event.streams || event.streams.length === 0 || !event.streams[0]) {
        console.warn('Received audio track without an associated stream.', event);
        return;
      }
      console.log('New audio track added for stream: ' + event.streams[0].id);
    } else {
      console.log('New track added: ' + event.track.kind);
    }
  };

  pc.onicegatheringstatechange = () =>
    console.log('Gathering state change: ' + pc.iceGatheringState);

  pc.onconnectionstatechange = () => {
    console.log('Connection state change: ' + pc.connectionState);
    const errorNode = document.getElementById('join-error-message');

    if (!errorNode) return; // Ensure errorNode exists

    if (pc.connectionState == 'failed') {
      errorNode.innerText = 'Connection unstable. Attempting to reconnect...';
      errorNode.classList.remove('hidden');
    } else if (pc.connectionState == 'disconnected') {
      errorNode.innerText = 'Disconnected. Attempting to reconnect...';
      errorNode.classList.remove('hidden');
    } else if (pc.connectionState == 'connected') {
      // Always hide the error message when connected, regardless of previous state
      errorNode.classList.add('hidden');
      errorNode.innerText = '';
    }
    // For 'new' and 'connecting' states, we don't explicitly hide or show a message
    // unless it's already showing a 'disconnected' or 'failed' message.
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
    const errorNode = document.getElementById('join-error-message');
    if (errorNode) {
      errorNode.innerText = 'Could not access webcam and microphone. Please ensure permissions are granted and no other application is using the camera.';
      errorNode.classList.remove('hidden');
    }
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

async function joinChannel(roomId, name) {
  const socket = new Socket('/socket');
  socket.connect();

  socket.onOpen(() => {
    console.log("Phoenix Socket reconnected. Requesting WebRTC renegotiation.");
    // Push an event to the channel to request a new SDP offer from the server
    channel.push("webrtc_renegotiate", {});
    // Also explicitly hide the error message on socket reconnection,
    // assuming WebRTC will follow shortly. This provides a quicker visual feedback.
    const errorNode = document.getElementById('join-error-message');
    if (errorNode && !errorNode.classList.contains('hidden')) {
      errorNode.classList.add('hidden');
      errorNode.innerText = '';
      console.log("Hidden error message on Phoenix Socket reconnection.");
    }
  });

  channel = socket.channel(`peer:${roomId}`, { name: name });

  channel.onError(() => {
    console.error('Phoenix channel error!');
    // Let the socket handle reconnection attempts
  });
  channel.onClose(() => {
    console.warn('Phoenix channel closed!');
    // Let the socket handle reconnection attempts
  });

  channel.on('sdp_offer', async (payload) => {
    const sdpOffer = payload.body;

    console.log('SDP offer received');

    // Check if pc is null before proceeding
    if (!pc) {
      console.warn('Received SDP offer but PeerConnection is null. Skipping.');
      return;
    }

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
    // Check if pc is null before proceeding
    if (!pc) {
      console.warn('Received ICE candidate but PeerConnection is null. Skipping.');
      return;
    }

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
        // When a peer leaves, remove their video container from the DOM and peerVideoElements map
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

          // If pc already exists, close it before creating a new one
          if (pc) {
            console.log("Closing existing PeerConnection before rejoining channel.");
            pc.close();
            pc = null; // Clear the reference
            localTracksAdded = false; // Reset flag for adding tracks
          }

          // Recreate PeerConnection
          try {
            await createPeerConnection(); // Ensure pc is re-initialized
          } catch (error) {
            console.error("Failed to create PeerConnection during channel rejoin:", error);
            const errorNode = document.getElementById('join-error-message');
            if (errorNode) {
              errorNode.innerText = 'Network is offline. Cannot establish video connection.';
              errorNode.classList.remove('hidden');
            }
            // IMPORTANT: If pc creation fails, we cannot proceed with WebRTC.
            // We might want to disconnect the channel or prevent further actions.
            // For now, we'll just log and display the error.
            return; // Stop further processing in this 'ok' handler
          }

          peerId = resp.peer_id;
          if (resp && resp.shared_video) {
            const video = resp.shared_video;
            if (video.type === 'youtube') {
              channel.trigger('youtube_video_shared', { video_id: video.id, sender: video.sender, sharer_id: video.sharer_id });
            } else if (video.type === 'direct') {
              channel.trigger('new_direct_video', { url: video.url, sender: video.sender, sharer_id: video.sharer_id });
            } else if (video.type === 'screen_share') {
              channel.trigger('screen_share_started', { sharer_id: video.sharer_id });
            }
          }

          // Re-add local tracks if localStream is available
          if (localStream && !localTracksAdded) {
            console.log('Re-adding local tracks to new peer connection');
            localStream.getTracks().forEach((track) => pc.addTrack(track));
            localTracksAdded = true;
          }
        })
        .receive('error', (resp) => {
          console.error('Unable to join the room:', resp);
          socket.disconnect();
    
          const localVideoContainer = document.getElementById('video-container-local');
          if (localVideoContainer) localVideoContainer.remove(); // Use .remove() for direct removal
          
          console.log(`Closing stream with id: ${localStream.id}`);
          localStream.getTracks().forEach((track) => track.stop());
          localStream = undefined;
    
          const errorNode = document.getElementById('join-error-message');
          errorNode.innerText = 'Unable to join the room';
          if (resp == 'peer_limit_reached') {
            errorNode.innerText +=
              ': Peer limit reached. Try again in a few minutes';
          } else if (resp == 'peer_start_failed') {
            errorNode.innerText +=
              ': Failed to initialize your connection. Please try again.';
          }
          errorNode.classList.remove('hidden');
        });
    
        channel.on('youtube_video_shared', (payload) => {
          sharerId = payload.sharer_id;
          const videoId = payload.video_id;

          const wrapper = document.createElement('div');
          wrapper.style.position = 'relative';
          wrapper.style.width = '100%';
          wrapper.style.height = '100%';

          const playerDiv = document.createElement('div');
          playerDiv.id = 'youtube-player';
          playerDiv.className = 'w-full h-full';
          wrapper.appendChild(playerDiv);
        
          const isSharer = peerId === sharerId;

          if (!isSharer) {
            const overlay = document.createElement('div');
            overlay.style.position = 'absolute';
            overlay.style.top = 0;
            overlay.style.left = 0;
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.zIndex = 10;
            wrapper.appendChild(overlay);
          }

          startPresentation(wrapper);
        
          youtubePlayer = new YT.Player('youtube-player', {
            videoId: videoId,
            playerVars: {
              autoplay: 1,
              controls: isSharer ? 1 : 0,
              rel: 0,
              iv_load_policy: 3,
            },
            events: {
              onReady: (event) => {
                if (isSharer) {
                  channel.push('player_state_change', {
                    state: event.data,
                    time: event.target.getCurrentTime(),
                  });
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
      if (peerId !== sharerId && youtubePlayer) {
        switch (payload.state) {
          case YT.PlayerState.PLAYING:
            youtubePlayer.seekTo(payload.time, true);
            youtubePlayer.playVideo();
            break;
          case YT.PlayerState.PAUSED:
            youtubePlayer.seekTo(payload.time, true);
            youtubePlayer.pauseVideo();
            break;
          case YT.PlayerState.ENDED:
            youtubePlayer.stopVideo();
            break;
        }
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
        videoPlayer.addEventListener('play', () => {
          channel.push('direct_video_state_change', { state: 'play', time: videoPlayer.currentTime });
        });
        videoPlayer.addEventListener('pause', () => {
          channel.push('direct_video_state_change', { state: 'pause', time: videoPlayer.currentTime });
        });
        videoPlayer.addEventListener('seeked', () => {
          channel.push('direct_video_state_change', { state: videoPlayer.paused ? 'pause' : 'play', time: videoPlayer.currentTime });
        });
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

      document.getElementById('open-youtube-modal').classList.add('hidden');
      if (isSharer) {
        document.getElementById('stop-sharing-button').classList.remove('hidden');
      }
    });

    channel.on('direct_video_state_change', (payload) => {
      if (peerId !== sharerId && sharedVideo.player) {
        sharedVideo.player.currentTime = payload.time;
        if (payload.state === 'play') {
          sharedVideo.player.play();
        } else {
          sharedVideo.player.pause();
        }
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
      console.log("screen_share_started event received:", payload);
      sharerId = payload.sharer_id;

      const screenShareVideoContainer = peerVideoElements[sharerId]?.videoContainer;
      if (screenShareVideoContainer) {
        startPresentation(screenShareVideoContainer);
        console.log(`Screen share from ${sharerId} moved to main stage after sharerId update.`);
      }
    });

    channel.on('screen_share_stopped', () => {
      console.log("screen_share_stopped event received.");
      sharerId = null;
      stopPresentation();
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

    await createPeerConnection();
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

    // Initial state for desktop: chat should be hidden by default
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
    // Initial call to set correct visibility based on screen size
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
    else {
        // On desktop, we don't automatically show/hide the chat based on window size.
        // Its visibility is controlled by the toggle button.
        // If it's desktop and chat is hidden, we do nothing here.
        // If it's desktop and chat is shown, we do nothing here.
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
        channel.push('share_youtube_video', { video_id: youtubeVideoId });
      } else if (url.match(/\.mp4$|\.webm$|\.ogg$/)) {
        channel.push('share_direct_video', { url: url });
      } else if (url.match(/^https:\/\/www\.heales\.com\/video\//)) {
        channel.push('share_heales_video', { url: url });
      } else {
        alert('Please enter a valid YouTube, direct video, or Heales video URL.');
      }

      youtubeUrlInput.value = ''; // Clear input
    });

    stopSharingButton.addEventListener('click', () => {
      if (this.isScreenSharing) {
        this.stopScreenShare();
      }
      else {
        channel.push('stop_video_share', {});
      }
    });

    document.getElementById('toggle-screen-share').addEventListener('click', () => this.startScreenShare());
  },

  async startScreenShare() {
    if (sharerId !== null) {
      alert('Another user is already presenting. Please wait for them to finish.');
      return;
    }
    if (this.isScreenSharing) return;

    try {
      const displayMediaOptions = {
        video: {
          cursor: "always",
          latencyHint: "motion",
          width: { max: 1280 },
          height: { max: 720 },
          frameRate: { max: 15 }
        }
      };
      this.screenShareStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
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
    this.isScreenSharing = true;

    channel.push('screen_share_started', { sharer_id: peerId });

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

    // The local camera feed (video-container-local) will be moved to filmstrip by startPresentation
    // No need to hide it explicitly.

    document.getElementById('open-youtube-modal').classList.add('hidden');
    document.getElementById('toggle-screen-share').classList.add('hidden');
    document.getElementById('stop-sharing-button').classList.remove('hidden');

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

    this.isScreenSharing = false;
    this.screenShareStream = null;
    this.originalVideoTrack = null;

    channel.push('screen_share_stopped', {});

    // Remove the local screen share video element from mainStage
    if (localScreenShareVideoElement && mainStage.contains(localScreenShareVideoElement)) {
      mainStage.removeChild(localScreenShareVideoElement);
    }
    localScreenShareVideoElement = null; // Clear the reference

    stopPresentation(); // This will revert the layout

    // Show local camera feed again
    const localCameraContainer = document.getElementById('video-container-local');
    if (localCameraContainer) {
      localCameraContainer.classList.remove('hidden');
    }

    document.getElementById('open-youtube-modal').classList.remove('hidden');
    document.getElementById('toggle-screen-share').classList.remove('hidden');
    document.getElementById('stop-sharing-button').classList.add('hidden');
  }
};