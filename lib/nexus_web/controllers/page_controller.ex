defmodule NexusWeb.PageController do
  use NexusWeb, :controller

  def home(conn, _params) do
    render(conn, :home, page_title: "Lobby")
  end

  def room(conn, %{"room_id" => room_id, "name" => name}) do
    room_token = Nexus.generate_room_token(room_id)
    render(conn, :room, room_id: room_id, name: name, room_token: room_token, page_title: "Room")
  end

  def room(conn, %{"room_id" => room_id}) do
    redirect(conn, to: ~p"/?room_id=#{room_id}")
  end
end
