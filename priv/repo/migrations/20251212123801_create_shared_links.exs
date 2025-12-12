defmodule Nexus.Repo.Migrations.CreateSharedLinks do
  use Ecto.Migration

  def change do
    create table(:shared_links) do
      add :url, :string
      add :timestamp, :utc_datetime
      add :room_id, references(:rooms, on_delete: :delete_all)
      add :participant_id, references(:participants, on_delete: :delete_all)

      timestamps()
    end
  end
end
