defmodule Nexus.Repo.Migrations.AddUniqueIndexToRoomsUuid do
  use Ecto.Migration

  def change do
    create unique_index(:rooms, [:uuid])
  end
end
