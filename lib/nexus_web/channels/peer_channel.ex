defmodule NexusWeb.PeerChannel do
  @moduledoc false

  use NexusWeb, :channel

  require Logger

  alias Nexus.{Peer, Rooms}
  alias NexusWeb.Presence

  @spec send_offer(GenServer.server(), String.t()) :: :ok
  def send_offer(channel, offer) do
    GenServer.cast(channel, {:offer, offer})
  end

  @spec send_candidate(GenServer.server(), String.t()) :: :ok
  def send_candidate(channel, candidate) do
    GenServer.cast(channel, {:candidate, candidate})
  end

  @spec send_track_mapping(pid(), Peer.id(), String.t()) :: :ok
  def send_track_mapping(channel, peer_id, stream_id) do
    GenServer.cast(channel, {:track_mapping, peer_id, stream_id})
  end

  @spec send_mid_mapping(pid(), Peer.id(), String.t(), atom()) :: :ok
  def send_mid_mapping(channel, peer_id, mid, kind) do
    GenServer.cast(channel, {:mid_mapping, peer_id, mid, kind})
  end

  @spec close(GenServer.server()) :: :ok
  def close(channel) do
    try do
      GenServer.stop(channel, :shutdown)
    catch
      _exit_or_error, _e -> :ok
    end

    :ok
  end

    @impl true
    def join("peer:" <> room_id, %{"name" => name}, socket) do
      pid = self()
  
      case Rooms.add_peer(room_id, pid) do
        {:ok, id, shared_video, start_time} -> 
          send(self(), {:after_join, shared_video})
          socket = 
            socket
            |> assign(:peer, id)
            |> assign(:name, name)
            |> assign(:room_id, room_id)
  
          {:ok, %{peer_id: id, start_time: start_time}, socket}
        {:error, _reason} = error -> error
      end
    end
  @impl true
  def handle_in("sdp_answer", %{"body" => body}, socket) do
    case Peer.apply_sdp_answer(socket.assigns.peer, body) do
      :ok ->
        {:noreply, socket}
      {:error, reason} ->
        Logger.warning("Failed to apply SDP answer for peer #{socket.assigns.peer}: #{inspect(reason)}")
        {:noreply, socket}
    end
  end

  @impl true
  def handle_in("sdp_offer", %{"body" => _body}, socket) do
    # TODO: renegotiate
    Logger.warning("Ignoring SDP offer sent by peer #{socket.assigns.peer}")
    {:noreply, socket}
  end

  @impl true
  def handle_in("ice_candidate", %{"body" => body}, socket) do
    Peer.add_ice_candidate(socket.assigns.peer, body)
    {:noreply, socket}
  end

  @impl true
  def handle_in("share_youtube_video", %{"video_id" => video_id}, socket) do
    Logger.info("Shared YouTube video: #{video_id} by #{socket.assigns.name}")
    sharer_id = socket.assigns.peer
    video_spec = %{type: :youtube, id: video_id, sender: socket.assigns.name, sharer_id: sharer_id}
    :ok = Rooms.set_shared_video(socket.assigns.room_id, video_spec)
    full_video_spec = Rooms.get_shared_video(socket.assigns.room_id)
    broadcast!(socket, "youtube_video_shared", full_video_spec)
    {:noreply, socket}
  end

  @impl true
  def handle_in("share_direct_video", %{"url" => url}, socket) do
    Logger.info("Shared direct video: #{url} by #{socket.assigns.name}")
    sharer_id = socket.assigns.peer
    Rooms.set_shared_video(socket.assigns.room_id, %{type: :direct, url: url, sender: socket.assigns.name, sharer_id: sharer_id})
    broadcast!(socket, "new_direct_video", %{url: url, sender: socket.assigns.name, sharer_id: sharer_id})
    {:noreply, socket}
  end

  def handle_in("share_heales_video", %{"url" => url}, socket) do
    Logger.info("Sharing Heales video: #{url} by #{socket.assigns.name}")
    try do
      uri = URI.parse(url)
      query_params = URI.decode_query(uri.query)
      case Map.get(query_params, "vid") do
        nil ->
          Logger.error("No vid parameter in Heales URL")
        vid ->
          # This URL format was discovered by inspecting the minified javascript on the Heales video page.
          video_url = "https://www.heales.com/video/assets/videos/hls_output/" <> vid <> "/index.m3u8"
          sharer_id = socket.assigns.peer
          Rooms.set_shared_video(socket.assigns.room_id, %{type: :direct, url: video_url, sender: socket.assigns.name, sharer_id: sharer_id})
          broadcast!(socket, "new_direct_video", %{url: video_url, sender: socket.assigns.name, sharer_id: sharer_id})
      end
    rescue e ->
      Logger.error("Failed to parse Heales URL: #{inspect(e)}")
    end
    {:noreply, socket}
  end

  @impl true
  def handle_in("stop_video_share", _, socket) do
    Rooms.clear_shared_video(socket.assigns.room_id)
    broadcast!(socket, "video_share_stopped", %{})
    {:noreply, socket}
  end

  @impl true
  def handle_in("new_message", %{"body" => body}, socket) do
    broadcast!(socket, "new_message", %{
      name: socket.assigns.name,
      body: body,
      timestamp: NaiveDateTime.utc_now() |> to_string()
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("draw_event", payload, socket) do
    broadcast_from!(socket, "draw_event", payload)
    {:noreply, socket}
  end

  @impl true
  def handle_in("whiteboard_toggled", %{"active" => active}, socket) do
    if active do
      sharer_id = socket.assigns.peer
      Rooms.set_shared_video(socket.assigns.room_id, %{type: :whiteboard, sharer_id: sharer_id})
    else
      Rooms.clear_shared_video(socket.assigns.room_id)
    end

    broadcast!(socket, "whiteboard_toggled", %{active: active})
    {:noreply, socket}
  end

  @impl true
  def handle_in("player_state_change", payload, socket) do
    case Rooms.get_shared_video(socket.assigns.room_id) do
      %{sharer_id: sharer_id} when sharer_id == socket.assigns.peer ->
        Rooms.update_video_state(socket.assigns.room_id, payload)
        broadcast_from!(socket, "player_state_change", payload)
      _ ->
        :ok
    end
    {:noreply, socket}
  end

  def handle_in("direct_video_state_change", payload, socket) do
    case Rooms.get_shared_video(socket.assigns.room_id) do
      %{sharer_id: sharer_id} when sharer_id == socket.assigns.peer ->
        broadcast_from!(socket, "direct_video_state_change", payload)
      _ ->
        :ok
    end
    {:noreply, socket}
  end

  @impl true
  def handle_in("screen_share_started", %{"sharer_id" => sharer_id}, socket) do
    Logger.info("Screen share started by #{sharer_id} in room #{socket.assigns.room_id}")
    Rooms.set_shared_video(socket.assigns.room_id, %{type: :screen_share, sharer_id: sharer_id})
    broadcast!(socket, "screen_share_started", %{sharer_id: sharer_id})
    {:noreply, socket}
  end

  @impl true
  def handle_in("screen_share_stopped", _, socket) do
    Logger.info("Screen share stopped in room #{socket.assigns.room_id}")
    Rooms.clear_shared_video(socket.assigns.room_id)
    broadcast!(socket, "screen_share_stopped", %{})
    {:noreply, socket}
  end

  @impl true
  def handle_in("webrtc_renegotiate", _payload, socket) do
    Logger.info("Peer #{socket.assigns.peer} requested WebRTC renegotiation.")
    # Trigger the peer to send a new SDP offer
    Peer.notify(socket.assigns.peer, :send_offer)
    {:noreply, socket}
  end

  @impl true
  def handle_cast({:offer, sdp_offer}, socket) do
    push(socket, "sdp_offer", %{"body" => sdp_offer})
    {:noreply, socket}
  end

  @impl true
  def handle_cast({:candidate, candidate}, socket) do
    push(socket, "ice_candidate", %{"body" => candidate})
    {:noreply, socket}
  end

  @impl true
  def handle_cast({:track_mapping, peer_id, stream_id}, socket) do
    push(socket, "track_mapping", %{peer_id: peer_id, stream_id: stream_id})
    {:noreply, socket}
  end

  @impl true
  def handle_cast({:mid_mapping, peer_id, mid, kind}, socket) do
    push(socket, "mid_mapping", %{peer_id: peer_id, mid: mid, kind: kind})
    {:noreply, socket}
  end

  @impl true
  def handle_info({:after_join, shared_video}, socket) do
    # We now pattern match on the map structure to ensure it's what we expect.
    # This prevents crashes if `shared_video` is truthy but not a map with the :type key.
    case shared_video do
      %{type: :youtube} ->
        push(socket, "youtube_video_shared", shared_video)
      %{type: :direct} ->
        push(socket, "new_direct_video", shared_video)
      %{type: :screen_share} ->
        push(socket, "screen_share_started", shared_video)
      %{type: :whiteboard} ->
        push(socket, "whiteboard_toggled", %{active: true})
      _ ->
        # If shared_video is nil, an empty map, or has the wrong shape, do nothing.
        :ok
    end

    {:ok, _ref} = Presence.track(socket, socket.assigns.peer, %{name: socket.assigns.name})
    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end
end
