defmodule Nexus.Repo.Migrations.CreateChatMessages do
  use Ecto.Migration

  def change do
    create table(:chat_messages) do
      add :message, :text
      add :timestamp, :utc_datetime
      add :room_id, references(:rooms, on_delete: :delete_all)
      add :participant_id, references(:participants, on_delete: :delete_all)

      timestamps()
    end
  end
end
