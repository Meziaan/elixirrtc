
defmodule Nexus.Database do
  @moduledoc """
  A module for interacting with the database.
  """

  def log(event, data) do
    # In a real application, this would write to a database.
    # For now, we'll just log to the console.
    IO.puts("DATABASE LOG: #{event} - #{inspect(data)}")
  end
end
