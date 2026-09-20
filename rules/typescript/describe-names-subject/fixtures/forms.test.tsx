import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LoginForm } from "../src/components/LoginForm";
import { SignupForm } from "../src/components/SignupForm";

describe("<LoginForm />", () => {
  it("submits the email and password", () => {
    const onSubmit = vi.fn();
    render(<LoginForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(onSubmit).toHaveBeenCalledWith({ email: "a@b.co", password: "pw" });
  });

  it("disables the button while submitting", () => {
    render(<LoginForm onSubmit={() => new Promise(() => {})} />);
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(screen.getByRole("button", { name: "Log in" })).toBeDisabled();
  });
});

describe("LoginForm validation", () => {
  it("requires a password confirmation", () => {
    render(<SignupForm onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(screen.getByText("Passwords must match")).toBeInTheDocument();
  });

  it("rejects a short password", () => {
    render(<SignupForm onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));
    expect(screen.getByText("At least 8 characters")).toBeInTheDocument();
  });
});
