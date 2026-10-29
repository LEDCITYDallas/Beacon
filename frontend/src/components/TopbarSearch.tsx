import React, { useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import Icon, { IconName } from "./Icon";
import StatusBadge from "./StatusBadge";
import { useAuth } from "../context/AuthContext";
import { Task } from "../types";
import { assignedId, assigneeName } from "../utils/dashboard";
import { formatDate } from "../utils/format";

export interface SearchPage {
  to: string;
  label: string;
  icon: IconName;
  keywords: string;
}

type Option =
  | { kind: "page"; id: string; page: SearchPage }
  | { kind: "task"; id: string; task: Task };

// Search across the pages this role can open and the tasks GET /tasks already
// scopes to the user (own tasks for employees, the department for managers,
// everything for the super admin). Tasks load on first focus and refresh at
// most once a minute; nothing is searched server-side.
export default function TopbarSearch({ pages }: { pages: SearchPage[] }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [taskError, setTaskError] = useState("");
  const loadedAt = useRef(0);
  const isManager = user?.role === "MANAGER" || user?.role === "SUPER_ADMIN";

  async function ensureTasks() {
    if (Date.now() - loadedAt.current < 60000) return;
    loadedAt.current = Date.now();
    try {
      const res = await client.get("/tasks");
      setTasks(res.data as Task[]);
      setTaskError("");
    } catch {
      setTaskError("Tasks cannot be searched right now.");
    }
  }

  const q = query.trim().toLowerCase();
  const pageMatches = q
    ? pages.filter((page) => page.label.toLowerCase().includes(q) || page.keywords.includes(q))
    : [];
  const taskMatches =
    q && tasks
      ? tasks
          .filter((task) => {
            if (!isManager && assignedId(task) !== user?.id) return false;
            const haystack = isManager
              ? `${task.title} ${assigneeName(task)} ${task.department}`
              : task.title;
            return haystack.toLowerCase().includes(q);
          })
          .slice(0, 6)
      : [];
  const options: Option[] = [
    ...pageMatches.map((page) => ({ kind: "page" as const, id: `${listId}-page-${page.to}`, page })),
    ...taskMatches.map((task) => ({ kind: "task" as const, id: `${listId}-task-${task._id}`, task })),
  ];
  const expanded = open && q.length > 0;

  function choose(option: Option) {
    setOpen(false);
    setQuery("");
    setActive(-1);
    if (option.kind === "page") {
      navigate(option.page.to);
    } else if (isManager) {
      navigate(`/team?q=${encodeURIComponent(option.task.title)}`);
    } else {
      navigate({ pathname: "/", hash: `task-${option.task._id}` });
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (options.length === 0 ? -1 : Math.min(options.length - 1, current + 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      const option = options[active] || options[0];
      if (expanded && option) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === "Escape") {
      if (expanded) {
        event.stopPropagation();
        setOpen(false);
      } else if (query) {
        setQuery("");
      }
    }
  }

  const activeId = expanded && active >= 0 ? options[active]?.id : undefined;

  function renderOption(option: Option, index: number) {
    return (
      <div
        key={option.id}
        id={option.id}
        role="option"
        aria-selected={index === active}
        className={`search-option${index === active ? " is-active" : ""}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      >
        {option.kind === "page" ? (
          <>
            <span className="search-option-icon" aria-hidden="true">
              <Icon name={option.page.icon} size={16} />
            </span>
            <span className="search-option-body">
              <span className="search-option-title">{option.page.label}</span>
            </span>
          </>
        ) : (
          <>
            <span className="search-option-body">
              <span className="search-option-title">{option.task.title}</span>
              <span className="search-option-meta">
                {isManager ? `${assigneeName(option.task)} · ` : ""}Due{" "}
                {formatDate(option.task.dueDate, user?.timezone)}
              </span>
            </span>
            <StatusBadge status={option.task.status} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="topbar-search">
      <label className="search-field">
        <Icon name="search" size={18} />
        <span className="sr-only">Search pages and tasks</span>
        <input
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          placeholder={isManager ? "Search tasks, people or pages" : "Search your tasks or pages"}
          value={query}
          onFocus={() => {
            setOpen(true);
            void ensureTasks();
          }}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
            void ensureTasks();
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <div className={`popover search-pop${expanded ? "" : " is-hidden"}`}>
        <div id={listId} role="listbox" aria-label="Search results">
          {expanded && pageMatches.length > 0 ? (
            <div role="group" aria-label="Pages">
              <div className="search-group" aria-hidden="true">
                Pages
              </div>
              {options.slice(0, pageMatches.length).map((option, index) => renderOption(option, index))}
            </div>
          ) : null}
          {expanded && taskMatches.length > 0 ? (
            <div role="group" aria-label="Tasks">
              <div className="search-group" aria-hidden="true">
                Tasks
              </div>
              {options
                .slice(pageMatches.length)
                .map((option, index) => renderOption(option, pageMatches.length + index))}
            </div>
          ) : null}
        </div>
        <div role="status" className="search-status">
          {expanded && options.length === 0
            ? taskError || (tasks === null ? "Loading tasks…" : `Nothing matches “${query.trim()}”.`)
            : expanded && taskError
              ? taskError
              : ""}
        </div>
      </div>
    </div>
  );
}
