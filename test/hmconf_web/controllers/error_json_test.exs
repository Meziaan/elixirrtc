defmodule HmconfWeb.ErrorJSONTest do
  use HmconfWeb.ConnCase, async: true

  test "renders 404" do
    assert HmconfWeb.ErrorJSON.render("404.json", %{}) == %{errors: %{detail: "Not Found"}}
  end

  test "renders 500" do
    assert HmconfWeb.ErrorJSON.render("500.json", %{}) ==
             %{errors: %{detail: "Internal Server Error"}}
  end
end
