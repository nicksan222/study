import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ProjectSchema } from "../generated/study_pb";
import { rpc } from "../rpc/client";
import { ProjectsPage, parseDay, dayInput } from "./projects";
import { renderPage } from "../test/helpers";
vi.mock("../rpc/client", () => ({
  rpc: { projects: vi.fn(), createProject: vi.fn(), setExam: vi.fn() },
}));
it("creates a project and persists an exam day using the typed calendar record", async () => {
  vi.mocked(rpc.projects).mockResolvedValue({ items: [] } as never);
  const project = create(ProjectSchema, { id: { value: 4n }, name: "Biology" });
  vi.mocked(rpc.createProject).mockResolvedValue(project);
  const user = userEvent.setup();
  renderPage(<ProjectsPage navigate={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "New project" }));
  await user.type(screen.getByLabelText(/Project name/), "Biology");
  const date = screen.getByLabelText(/Exam day/);
  await user.type(date, "2027-06-15");
  await user.click(screen.getByRole("button", { name: "Create project" }));
  await waitFor(() =>
    expect(rpc.setExam).toHaveBeenCalledWith({
      id: project.id,
      examOn: { year: 2027, month: 6, day: 15 },
    }),
  );
});
it("calendar inputs round trip without a timezone shift and clearing removes the exam", () => {
  expect(dayInput({ year: 2027, month: 1, day: 2 } as never)).toBe(
    "2027-01-02",
  );
  expect(parseDay("2027-01-02")).toEqual({ year: 2027, month: 1, day: 2 });
  expect(parseDay("")).toBeUndefined();
});
