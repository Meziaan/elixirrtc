defmodule Hmconf.Repo.Migrations.CreateSharedLinks do
  use Ecto.Migration

  def change do
    create table(:shared_links, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :url, :string
      add :shared_at, :utc_datetime
      add :room_id, references(:rooms, on_delete: :delete_all, type: :binary_id), null: false

      timestamps()
    end

    create index(:shared_links, [:room_id])
  end
end