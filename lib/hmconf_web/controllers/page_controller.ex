defmodule HmconfWeb.PageController do
  use HmconfWeb, :controller

  def home(conn, _params) do
    render(conn, :home, page_title: "Lobby")
  end

  def room(conn, %{"room_id" => room_id, "name" => name}) do
    render(conn, :room, room_id: room_id, name: name, page_title: "Room")
  end

  def room(conn, %{"room_id" => room_id}) do
    redirect(conn, to: ~p"/?room_id=#{room_id}")
  end
end
