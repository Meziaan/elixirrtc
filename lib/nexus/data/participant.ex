defmodule Nexus.Data.Participant do
  use Ecto.Schema
  import Ecto.Changeset

  schema "participants" do
    field :name, :string
    field :joined_at, :utc_datetime
    field :left_at, :utc_datetime
    belongs_to :room, Nexus.Data.Room

    has_many :chat_messages, Nexus.Data.ChatMessage
    has_many :shared_links, Nexus.Data.SharedLink

    timestamps()
  end

  @doc false
  def changeset(participant, attrs) do
    participant
    |> cast(attrs, [:name, :joined_at, :left_at])
    |> validate_required([:name, :joined_at])
  end
end
