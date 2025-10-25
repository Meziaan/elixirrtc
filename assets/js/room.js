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

function startPresentation(sharedVideoElement) {
  presentationLayout.classList.remove('hidden');
  videoPlayerWrapper.classList.add('hidden');

  // Move all video elements to the filmstrip
  while (videoPlayerWrapper.firstChild) {
    filmstrip.appendChild(videoPlayerWrapper.firstChild);
  }

  mainStage.appendChild(sharedVideoElement);
}

function stopPresentation() {
  presentationLayout.classList.add('hidden');
  videoPlayerWrapper.classList.remove('hidden');

  // Move all video elements back to the grid
  while (filmstrip.firstChild) {
    videoPlayerWrapper.appendChild(filmstrip.firstChild);
  }

  mainStage.innerHTML = '';
}

async function createPeerConnection() {
  pc = new RTCPeerConnection(pcConfig);

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
    if (pc.connectionState == 'failed') {
      pc.restartIce();
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
    alert('Could not access webcam and microphone. Please ensure permissions are granted and no other application is using the camera.');
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
  channel = socket.channel(`peer:${roomId}`, { name: name });

  channel.onError(() => {
    console.error('Phoenix channel error!');
    socket.disconnect();
    // window.location.reload(); // Commented out for debugging
  });
  channel.onClose(() => {
    console.warn('Phoenix channel closed!');
    socket.disconnect();
    // window.location.reload(); // Commented out for debugging
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
          peerId = resp.peer_id;
          if (resp && resp.shared_video) {
            const video = resp.shared_video;
            if (video.type === 'youtube') {
              channel.trigger('youtube_video_shared', { video_id: video.id, sender: video.sender, sharer_id: video.sharer_id });
            } else {
              channel.trigger('new_direct_video', { url: video.url, sender: video.sender, sharer_id: video.sharer_id });
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
                  event.target.playVideo();
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
      videoPlayer.src = url;
      videoPlayer.controls = isSharer;
      videoPlayer.autoplay = true;
      videoPlayer.className = 'w-full h-full object-contain';
      startPresentation(videoPlayer);

      document.getElementById('open-youtube-modal').classList.add('hidden');
      if (isSharer) {
        document.getElementById('stop-sharing-button').classList.remove('hidden');
      }
    });

    channel.on('video_share_stopped', () => {
      stopPresentation();
      if (youtubePlayer) {
        youtubePlayer.destroy();
        youtubePlayer = null;
      }
      sharerId = null;
      document.getElementById('open-youtube-modal').classList.remove('hidden');
      document.getElementById('stop-sharing-button').classList.add('hidden');
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
      } else {
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
    } else {
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
      } else {
        alert('Please enter a valid YouTube or direct video URL.');
      }

      youtubeUrlInput.value = ''; // Clear input
    });

    stopSharingButton.addEventListener('click', () => {
      if (this.isScreenSharing) {
        this.stopScreenShare();
      } else {
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
    this.isScreenSharing = true;

    const screenVideoElement = document.createElement('video');
    screenVideoElement.srcObject = this.screenShareStream;
    screenVideoElement.autoplay = true;
    screenVideoElement.playsInline = true;
    screenVideoElement.className = 'w-full h-full object-contain';
    startPresentation(screenVideoElement);

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

    stopPresentation();

    document.getElementById('open-youtube-modal').classList.remove('hidden');
    document.getElementById('toggle-screen-share').classList.remove('hidden');
    document.getElementById('stop-sharing-button').classList.add('hidden');
  }
};