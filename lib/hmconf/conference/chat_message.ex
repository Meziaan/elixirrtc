defmodule Hmconf.Conference.ChatMessage do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "chat_messages" do
    field :body, :string

    belongs_to :room, Hmconf.Conference.Room, type: :binary_id
    belongs_to :participant, Hmconf.Conference.Participant, type: :binary_id

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(chat_message, attrs) do
    chat_message
    |> cast(attrs, [:body, :room_id, :participant_id])
    |> validate_required([:body, :room_id, :participant_id])
  end
end
