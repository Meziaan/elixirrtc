# Video Conferencing Application

A real-time video and audio conferencing application.

## Development

To start the development server:

1.  Install dependencies with `mix setup`
2.  Run the server with `mix phx.server`

Now you can visit [`localhost:4000`](http://localhost:4000) from your browser.

## Troubleshooting

### Unique Violation on `rooms_uuid_index`

If you encounter a `(Postgrex.Error) ERROR 23505 (unique_violation)` when running migrations, it means you have duplicate room `uuid`s in your database.

To fix this, you need to manually remove the duplicate entries.

1.  Start an `iex` session with `iex -S mix`.
2.  Run the following commands to find and delete the duplicate rooms, keeping the most recent one:
    ```elixir
    alias Nexus.Data.Room
    alias Nexus.Repo
    import Ecto.Query

    duplicates =
      from(r in Room,
        select: {r.uuid, count(r.id)},
        group_by: r.uuid,
        having: count(r.id) > 1
      )
      |> Repo.all()

    for {uuid, _count} <- duplicates do
      rooms_to_delete =
        from(r in Room, where: r.uuid == ^uuid, order_by: [desc: r.inserted_at])
        |> Repo.all()
        |> Enum.drop(1)

      Enum.each(rooms_to_delete, fn room -> Repo.delete(room) end)
      IO.puts("Deleted #{length(rooms_to_delete)} duplicate entries for room UUID: #{uuid}")
    end
    ```
3.  Exit `iex` and run `mix ecto.migrate` again.