defmodule Hmconf.Conference.RoomMessage do
  @moduledoc """
  Schema for chat messages in a conference room.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "room_messages" do
    field(:content, :string)
    field(:sent_at, :utc_datetime)

    belongs_to(:room, Hmconf.Conference.Room)

    timestamps()
  end

  @doc false
  def changeset(room_message, attrs) do
    room_message
    |> cast(attrs, [:content, :sent_at])
    |> validate_required([:content, :sent_at])
  end
end
