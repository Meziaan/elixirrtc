defmodule HmconfWeb.PageController do
  use HmconfWeb, :controller

  alias Hmconf.Conference

  def home(conn, _params) do
    render(conn, :home, page_title: "Lobby", csrf_token: Plug.CSRFProtection.get_csrf_token())
  end

  def create_room(conn, %{"room_id" => room_id, "name" => name}) do
    room = Conference.create_room!(room_id)
    redirect(conn, to: ~p"/#{room.short_code}?name=#{name}")
  end

  def room(conn, %{"room_id" => room_id, "name" => name}) do
    room = Conference.find_or_create_room!(room_id)

    if room.short_code != room_id do
      redirect(conn, to: ~p"/#{room.short_code}?name=#{name}")
    else
      render(conn, :room, room_id: room.short_code, name: name, page_title: "Room")
    end
  end

  def room(conn, %{"room_id" => room_id}) do
    redirect(conn, to: ~p"/?room_id=#{room_id}")
  end
end