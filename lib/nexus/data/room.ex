defmodule Nexus.Data.Room do
  use Ecto.Schema
  import Ecto.Changeset

  schema "rooms" do
    field :uuid, :string
    field :name, :string
    field :started_at, :utc_datetime
    field :ended_at, :utc_datetime

    has_many :participants, Nexus.Data.Participant
    has_many :chat_messages, Nexus.Data.ChatMessage
    has_many :shared_links, Nexus.Data.SharedLink

    timestamps()
  end

  @doc false
  def changeset(room, attrs) do
    room
    |> cast(attrs, [:uuid, :name, :started_at, :ended_at])
    |> validate_required([:uuid, :name])
  end
end
