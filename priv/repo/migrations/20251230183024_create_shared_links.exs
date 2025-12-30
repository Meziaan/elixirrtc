defmodule Nexus.Repo.Migrations.CreateSharedLinks do
  use Ecto.Migration

  def change do
    create table(:shared_links, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :url, :string
      add :room_id, references(:rooms, on_delete: :delete_all, type: :binary_id)
      add :participant_id, references(:participants, on_delete: :delete_all, type: :binary_id)

      timestamps()
    end
  end
end