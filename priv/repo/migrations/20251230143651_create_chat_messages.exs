defmodule Hmconf.Repo.Migrations.CreateChatMessages do
  use Ecto.Migration

  def change do
    create table(:chat_messages, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :body, :text, null: false
      add :room_id, references(:rooms, type: :binary_id, on_delete: :nothing), null: false
      add :participant_id, references(:participants, type: :binary_id, on_delete: :nothing), null: false

      timestamps()
    end

    create index(:chat_messages, [:room_id])
    create index(:chat_messages, [:participant_id])
  end
end
