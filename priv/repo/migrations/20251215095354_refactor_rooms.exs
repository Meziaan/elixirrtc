defmodule Nexus.Repo.Migrations.RefactorRooms do
  use Ecto.Migration

  def up do
    # 1. Add the :name column, allowing nulls for now
    alter table(:rooms) do
      add :name, :string
    end

    # 2. Update existing rows to populate the new :name column
    # We'll copy the 'uuid' to 'name' for existing rooms.
    execute "UPDATE rooms SET name = uuid"

    # 3. Now that all rows have a value, add the NOT NULL constraint
    alter table(:rooms) do
      modify :name, :string, null: false
    end

    # Create indices
    create unique_index(:rooms, [:uuid], name: :rooms_uuid_index)
    create index(:rooms, [:name])
  end

  def down do
    # Define how to reverse the migration
    drop index(:rooms, [:name])
    drop index(:rooms, [:rooms_uuid_index])

    alter table(:rooms) do
      remove :name
    end
  end
end
