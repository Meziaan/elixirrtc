defmodule Nexus.Data.ChatMessage do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "chat_messages" do
    field :body, :string
    belongs_to :room, Nexus.Data.Room
    belongs_to :participant, Nexus.Data.Participant

    timestamps()
  end

  @doc false
  def changeset(chat_message, attrs) do
    chat_message
    |> cast(attrs, [:body, :room_id, :participant_id])
    |> validate_required([:body, :room_id, :participant_id])
  end
end