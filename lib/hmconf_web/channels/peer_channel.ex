defmodule HmconfWeb.PeerChannel do
  @moduledoc false

  use HmconfWeb, :channel

  require Logger

  alias Hmconf.{Conference, Peer, Rooms}
  alias HmconfWeb.Presence

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

    case Rooms.add_peer(room_id, pid, name) do
      {:ok, id, participant_id, shared_video, whiteboard_history, video_state} ->
        send(self(), {:after_join, shared_video, whiteboard_history, video_state})

        socket =
          socket
          |> assign(:peer, id)
          |> assign(:participant_id, participant_id)
          |> assign(:name, name)
          |> assign(:room_id, room_id)

        {:ok,
         %{
           peer_id: id,
           shared_video: shared_video,
           whiteboard_history: whiteboard_history,
           video_state: video_state
         }, socket}

      {:error, _reason} = error ->
        error
    end
  end

  @impl true
  def handle_in("sdp_answer", %{"body" => body}, socket) do
    :ok = Peer.apply_sdp_answer(socket.assigns.peer, body)
    {:noreply, socket}
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
    room_id = socket.assigns.room_id

    # Save the shared link to the database
    with {:ok, room} <- Conference.get_room(room_id) do
      Conference.create_shared_link(room, %{
        url: "https://www.youtube.com/watch?v=#{video_id}",
        shared_at: DateTime.utc_now()
      })
    end

    Rooms.set_shared_video(room_id, %{
      type: :youtube,
      id: video_id,
      sender: socket.assigns.name,
      sharer_id: sharer_id
    })

    broadcast!(socket, "youtube_video_shared", %{
      video_id: video_id,
      sender: socket.assigns.name,
      sharer_id: sharer_id
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("share__video", %{"url" => url}, socket) do
    Logger.info("Shared direct video: #{url} by #{socket.assigns.name}")
    sharer_id = socket.assigns.peer
    room_id = socket.assigns.room_id

    # Save the shared link to the database
    with {:ok, room} <- Conference.get_room(room_id) do
      Conference.create_shared_link(room, %{url: url, shared_at: DateTime.utc_now()})
    end

    Rooms.set_shared_video(room_id, %{
      type: :direct,
      url: url,
      sender: socket.assigns.name,
      sharer_id: sharer_id
    })

    broadcast!(socket, "new_direct_video", %{
      url: url,
      sender: socket.assigns.name,
      sharer_id: sharer_id
    })

    {:noreply, socket}
  end

  def handle_in("share_heales_video", %{"url" => url}, socket) do
    Logger.info("Sharing Heales video: #{url} by #{socket.assigns.name}")
    room_id = socket.assigns.room_id

    try do
      uri = URI.parse(url)
      query_params = URI.decode_query(uri.query)

      case Map.get(query_params, "vid") do
        nil ->
          Logger.error("No vid parameter in Heales URL")

        vid ->
          # This URL format was discovered by inspecting the minified javascript on the Heales video page.
          video_url =
            "https://www.heales.com/video/assets/videos/hls_output/" <> vid <> "/index.m3u8"

          sharer_id = socket.assigns.peer

          # Save the shared link to the database
          with {:ok, room} <- Conference.get_room(room_id) do
            Conference.create_shared_link(room, %{
              url: video_url,
              shared_at: DateTime.utc_now()
            })
          end

          Rooms.set_shared_video(room_id, %{
            type: :direct,
            url: video_url,
            sender: socket.assigns.name,
            sharer_id: sharer_id
          })

          broadcast!(socket, "new_direct_video", %{
            url: video_url,
            sender: socket.assigns.name,
            sharer_id: sharer_id
          })
      end
    rescue
      e ->
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
    room_id = socket.assigns.room_id
    participant_id = socket.assigns.participant_id

    # Save the message to the database
    with {:ok, room} <- Conference.get_room(room_id) do
      Conference.create_message(room, %{
        content: body,
        sent_at: DateTime.utc_now(),
        participant_id: participant_id
      })
    end

    broadcast!(socket, "new_message", %{
      name: socket.assigns.name,
      body: body,
      timestamp: NaiveDateTime.utc_now() |> to_string()
    })

    {:noreply, socket}
  end

  @impl true
  def handle_in("player_state_change", payload, socket) do
    case Rooms.get_shared_video(socket.assigns.room_id) do
      %{sharer_id: sharer_id} when sharer_id == socket.assigns.peer ->
        Rooms.set_video_state(socket.assigns.room_id, payload)
        broadcast_from!(socket, "player_state_change", payload)

      _ ->
        :ok
    end

    {:noreply, socket}
  end

  def handle_in("direct_video_state_change", payload, socket) do
    case Rooms.get_shared_video(socket.assigns.room_id) do
      %{sharer_id: sharer_id} when sharer_id == socket.assigns.peer ->
        Rooms.set_video_state(socket.assigns.room_id, payload)
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
  def handle_in("start_whiteboard", _, socket) do
    sharer_id = socket.assigns.peer
    Logger.info("Whiteboard started by #{sharer_id} in room #{socket.assigns.room_id}")
    Rooms.set_shared_video(socket.assigns.room_id, %{type: :whiteboard, sharer_id: sharer_id})
    broadcast!(socket, "whiteboard_started", %{sharer_id: sharer_id})
    {:noreply, socket}
  end

  @impl true
  def handle_in("stop_whiteboard", _, socket) do
    Logger.info("Whiteboard stopped in room #{socket.assigns.room_id}")
    Rooms.clear_shared_video(socket.assigns.room_id)
    broadcast!(socket, "whiteboard_stopped", %{})
    {:noreply, socket}
  end

  @impl true
  def handle_in("whiteboard_draw", data, socket) do
    Rooms.whiteboard_draw(socket.assigns.room_id, data)
    broadcast_from!(socket, "whiteboard_draw", data)
    {:noreply, socket}
  end

  @impl true
  def handle_in("whiteboard_clear", _, socket) do
    # This should also clear the history on the backend
    Rooms.set_shared_video(socket.assigns.room_id, %{
      type: :whiteboard,
      sharer_id: socket.assigns.peer
    })

    broadcast!(socket, "whiteboard_clear", %{})
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
  def handle_info({:after_join, shared_video, whiteboard_history, video_state}, socket) do
    if shared_video do
      case shared_video.type do
        :youtube ->
          push(socket, "youtube_video_shared", %{
            video_id: shared_video.id,
            sender: shared_video.sender,
            sharer_id: shared_video.sharer_id
          })

          if video_state, do: push(socket, "player_state_change", video_state)

        :direct ->
          push(socket, "new_direct_video", %{
            url: shared_video.url,
            sender: shared_video.sender,
            sharer_id: shared_video.sharer_id
          })

          if video_state, do: push(socket, "direct_video_state_change", video_state)

        :screen_share ->
          push(socket, "screen_share_started", %{sharer_id: shared_video.sharer_id})

        :whiteboard ->
          push(socket, "whiteboard_started", %{
            sharer_id: shared_video.sharer_id,
            history: whiteboard_history
          })
      end
    end

    {:ok, _ref} = Presence.track(socket, socket.assigns.peer, %{name: socket.assigns.name})
    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  @impl true
  def handle_info({:sharing_stopped, type}, socket) do
    event =
      case type do
        :youtube -> "video_share_stopped"
        :direct -> "video_share_stopped"
        :screen_share -> "screen_share_stopped"
        :whiteboard -> "whiteboard_stopped"
        _ -> nil
      end

    if event, do: push(socket, event, %{})
    {:noreply, socket}
  end
end
