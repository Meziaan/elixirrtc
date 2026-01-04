defmodule Hmconf.Repo.Migrations.AddParticipantDetails do
  use Ecto.Migration

  def change do
    alter table(:room_participants) do
      add :name, :string
    end

    alter table(:room_messages) do
      add :participant_id, references(:room_participants, on_delete: :nothing, type: :binary_id)
    end

    alter table(:shared_links) do
      add :participant_id, references(:room_participants, on_delete: :nothing, type: :binary_id)
    end
  end
end
