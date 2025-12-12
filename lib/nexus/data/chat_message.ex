defmodule Nexus.Data.ChatMessage do
  use Ecto.Schema
  import Ecto.Changeset

  schema "chat_messages" do
    field :message, :string
    field :timestamp, :utc_datetime
    belongs_to :room, Nexus.Data.Room
    belongs_to :participant, Nexus.Data.Participant

    timestamps()
  end

  @doc false
  def changeset(chat_message, attrs) do
    chat_message
    |> cast(attrs, [:message, :timestamp])
    |> validate_required([:message, :timestamp])
  end
end
