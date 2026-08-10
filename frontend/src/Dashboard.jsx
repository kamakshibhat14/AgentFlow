import { useEffect, useState } from "react";
import { nhost } from "./lib/nhost";

const ORG_ID =
  "20e495a0-2f17-4ec0-845a-52d0e53b209e";

/* =========================================================
   LOAD WORKFLOWS
   ========================================================= */

const GET_WORKFLOWS = `
  query GetWorkflows {
    workflows {
      id
      name
      description
      org_id

      workflow_steps(
        order_by: { step_order: asc }
      ) {
        id
        name
        step_order
        type
        config
      }

      workflow_triggers {
        id
        type
        enabled
        config
      }

      workflow_runs(
        order_by: { created_at: desc }
        limit: 1
      ) {
        id
        status
        trigger_type
        created_at
      }
    }
  }
`;

/* =========================================================
   CREATE WORKFLOW

   IMPORTANT:
   NO description
   NO created_by

   Your current Hasura schema does not expose these
   fields in workflows_insert_input.
   ========================================================= */

const CREATE_WORKFLOW = `
  mutation CreateWorkflow(
    $org_id: uuid!
    $name: String!
  ) {
    insert_workflows_one(
      object: {
        org_id: $org_id
        name: $name
      }
    ) {
      id
      org_id
      name
    }
  }
`;

/* =========================================================
   CREATE STEP
   ========================================================= */

const CREATE_STEP = `
  mutation CreateStep(
    $workflow_id: uuid!
    $step_order: Int!
    $name: String!
    $type: String!
    $config: jsonb!
  ) {
    insert_workflow_steps_one(
      object: {
        workflow_id: $workflow_id
        step_order: $step_order
        name: $name
        type: $type
        config: $config
      }
    ) {
      id
      workflow_id
      step_order
      name
      type
      config
    }
  }
`;

/* =========================================================
   CREATE TRIGGER
   ========================================================= */

const CREATE_TRIGGER = `
  mutation CreateTrigger(
    $workflow_id: uuid!
    $type: String!
    $config: jsonb!
    $enabled: Boolean!
  ) {
    insert_workflow_triggers_one(
      object: {
        workflow_id: $workflow_id
        type: $type
        config: $config
        enabled: $enabled
      }
    ) {
      id
      workflow_id
      type
      config
      enabled
    }
  }
`;

/* =========================================================
   DASHBOARD
   ========================================================= */

function Dashboard({ user, onLogout }) {

  const [workflows, setWorkflows] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [showCreate, setShowCreate] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [success, setSuccess] =
    useState("");

  const [workflowName, setWorkflowName] =
    useState("AI Approval Workflow");

  /* =======================================================
     LOAD WORKFLOWS
     ======================================================= */

  const loadWorkflows = async () => {

    try {

      setLoading(true);
      setError("");

      console.log("Loading workflows...");

      const response =
        await nhost.graphql.request({
          query: GET_WORKFLOWS,
        });

      console.log(
        "WORKFLOW RESPONSE:",
        response
      );

      if (response.error) {
        throw new Error(
          response.error.message
        );
      }

      const data =
        response.body?.data?.workflows || [];

      console.log(
        "WORKFLOWS:",
        data
      );

      setWorkflows(data);

    } catch (err) {

      console.error(
        "LOAD WORKFLOW ERROR:",
        err
      );

      setError(
        err?.message ||
        "Failed to load workflows."
      );

    } finally {

      setLoading(false);

    }
  };

  /* =======================================================
     CREATE STEP
     ======================================================= */

  const createStep = async ({
    workflowId,
    order,
    name,
    type,
    config,
  }) => {

    console.log(
      "Creating step:",
      order,
      name
    );

    const response =
      await nhost.graphql.request({
        query: CREATE_STEP,

        variables: {
          workflow_id: workflowId,
          step_order: order,
          name,
          type,
          config,
        },
      });

    console.log(
      "STEP RESPONSE:",
      response
    );

    if (response.error) {
      throw new Error(
        response.error.message
      );
    }

    const step =
      response.body?.data
        ?.insert_workflow_steps_one;

    if (!step) {
      throw new Error(
        `Step ${order} was not created.`
      );
    }

    return step;
  };

  /* =======================================================
     CREATE TRIGGER
     ======================================================= */

  const createTrigger = async ({
    workflowId,
    type,
    config = {},
  }) => {

    console.log(
      "Creating trigger:",
      type
    );

    const response =
      await nhost.graphql.request({
        query: CREATE_TRIGGER,

        variables: {
          workflow_id: workflowId,
          type,
          config,
          enabled: true,
        },
      });

    console.log(
      "TRIGGER RESPONSE:",
      response
    );

    if (response.error) {
      throw new Error(
        response.error.message
      );
    }

    const trigger =
      response.body?.data
        ?.insert_workflow_triggers_one;

    if (!trigger) {
      throw new Error(
        `${type} trigger was not created.`
      );
    }

    return trigger;
  };

  /* =======================================================
     CREATE COMPLETE WORKFLOW
     ======================================================= */

  const handleCreateWorkflow =
    async () => {

      if (!workflowName.trim()) {

        setError(
          "Workflow name is required."
        );

        return;
      }

      try {

        setSaving(true);
        setError("");
        setSuccess("");

        console.log(
          "=============================="
        );

        console.log(
          "CREATING WORKFLOW"
        );

        console.log(
          "=============================="
        );

        /* ===============================================
           STEP 1
           CREATE WORKFLOW
           =============================================== */

        const workflowResponse =
          await nhost.graphql.request({

            query: CREATE_WORKFLOW,

            variables: {
              org_id: ORG_ID,
              name: workflowName.trim(),
            },

          });

        console.log(
          "CREATE WORKFLOW RESPONSE:",
          workflowResponse
        );

        if (workflowResponse.error) {

          throw new Error(
            workflowResponse.error.message
          );

        }

        const workflow =
          workflowResponse.body
            ?.data
            ?.insert_workflows_one;

        if (!workflow?.id) {

          throw new Error(
            "Workflow was not created."
          );

        }

        const workflowId =
          workflow.id;

        console.log(
          "WORKFLOW CREATED:",
          workflowId
        );

        /* ===============================================
           STEP 2
           LLM
           =============================================== */

        await createStep({

          workflowId,

          order: 1,

          name:
            "Generate AI Response",

          type:
            "llm_call",

          config: {
            prompt:
              "Generate a response for the workflow input.",
          },

        });

        /* ===============================================
           STEP 3
           HTTP
           =============================================== */

        await createStep({

          workflowId,

          order: 2,

          name:
            "HTTP Data Request",

          type:
            "http_request",

          config: {
            method: "GET",

            url:
              "https://jsonplaceholder.typicode.com/todos/1",
          },

        });

        /* ===============================================
           STEP 4
           CONDITIONAL
           =============================================== */

        await createStep({

          workflowId,

          order: 3,

          name:
            "Conditional Branch",

          type:
            "conditional_branch",

          config: {
            condition:
              "Check previous step output.",
          },

        });

        /* ===============================================
           STEP 5
           APPROVAL
           =============================================== */

        await createStep({

          workflowId,

          order: 4,

          name:
            "Owner Approval",

          type:
            "approval_gate",

          config: {
            required_role:
              "owner",
          },

        });

        /* ===============================================
           STEP 6
           MANUAL TRIGGER
           =============================================== */

        await createTrigger({

          workflowId,

          type:
            "manual",

        });

        /* ===============================================
           STEP 7
           WEBHOOK TRIGGER
           =============================================== */

        await createTrigger({

          workflowId,

          type:
            "webhook",

        });

        /* ===============================================
           SUCCESS
           =============================================== */

        console.log(
          "=============================="
        );

        console.log(
          "WORKFLOW CREATED SUCCESSFULLY"
        );

        console.log(
          "=============================="
        );

        setSuccess(
          "Workflow created successfully!"
        );

        setShowCreate(false);

        await loadWorkflows();

      } catch (err) {

        console.error(
          "CREATE WORKFLOW ERROR:",
          err
        );

        setError(
          err?.message ||
          "Failed to create workflow."
        );

      } finally {

        setSaving(false);

      }
    };

  /* =======================================================
     INITIAL LOAD
     ======================================================= */

  useEffect(() => {

    loadWorkflows();

  }, []);

  /* =======================================================
     UI
     ======================================================= */

  return (

    <div style={styles.page}>

      {/* HEADER */}

      <header style={styles.header}>

        <div>

          <h1 style={styles.logo}>
            AgentFlow
          </h1>

          <div style={styles.subtitle}>
            AI Agent Workflow Builder
          </div>

        </div>

        <div style={styles.headerRight}>

          <span style={styles.user}>
            {user?.email || "User"}
          </span>

          <button
            onClick={onLogout}
            style={styles.logout}
          >
            Logout
          </button>

        </div>

      </header>

      {/* MAIN */}

      <main style={styles.content}>

        {/* TITLE */}

        <div style={styles.titleRow}>

          <div>

            <h2 style={styles.title}>
              Workflows
            </h2>

            <p style={styles.description}>
              Manage your organization's workflows
            </p>

          </div>

          <button
            onClick={() => {
              setShowCreate(true);
              setError("");
              setSuccess("");
            }}
            style={styles.createButton}
          >
            + Create Workflow
          </button>

        </div>

        {/* SUCCESS */}

        {success && (

          <div style={styles.success}>
            {success}
          </div>

        )}

        {/* ERROR */}

        {error && (

          <div style={styles.error}>
            <strong>Error:</strong>{" "}
            {error}
          </div>

        )}

        {/* CREATE FORM */}

        {showCreate && (

          <div style={styles.createCard}>

            <div style={styles.createHeader}>

              <h2>
                Create Workflow
              </h2>

              <button
                onClick={() =>
                  setShowCreate(false)
                }
                style={styles.cancel}
                disabled={saving}
              >
                Cancel
              </button>

            </div>

            <label style={styles.label}>
              Workflow Name
            </label>

            <input
              value={workflowName}
              onChange={(e) =>
                setWorkflowName(
                  e.target.value
                )
              }
              style={styles.input}
              disabled={saving}
            />

            <h3 style={styles.section}>
              Workflow Steps
            </h3>

            <Step
              number="1"
              title="Generate AI Response"
              type="llm_call"
              text="Calls the LLM and generates output."
            />

            <Step
              number="2"
              title="HTTP Data Request"
              type="http_request"
              text="Calls an external HTTP API."
            />

            <Step
              number="3"
              title="Conditional Branch"
              type="conditional_branch"
              text="Changes behavior based on previous output."
            />

            <Step
              number="4"
              title="Owner Approval"
              type="approval_gate"
              text="Pauses execution until approved."
            />

            <h3 style={styles.section}>
              Triggers
            </h3>

            <div style={styles.triggers}>
              ✓ Manual
              <span style={{ marginLeft: 30 }}>
                ✓ Webhook
              </span>
            </div>

            <button
              onClick={
                handleCreateWorkflow
              }
              style={styles.save}
              disabled={saving}
            >
              {saving
                ? "Saving..."
                : "Save Workflow"}
            </button>

          </div>

        )}

        {/* LOADING */}

        {loading && (

          <div style={styles.message}>
            Loading workflows...
          </div>

        )}

        {/* WORKFLOWS */}

        {!loading &&
          workflows.length > 0 && (

            <div style={styles.grid}>

              {workflows.map(
                (workflow) => {

                  const latestRun =
                    workflow
                      .workflow_runs?.[0];

                  return (

                    <div
                      key={workflow.id}
                      style={styles.card}
                    >

                      <h3>
                        {workflow.name}
                      </h3>

                      {workflow.description && (

                        <p>
                          {workflow.description}
                        </p>

                      )}

                      <div style={styles.info}>

                        <span>
                          Organization:{" "}
                          {workflow.org_id}
                        </span>

                        <span>
                          Steps:{" "}
                          {
                            workflow
                              .workflow_steps
                              ?.length || 0
                          }
                        </span>

                        <span>
                          Trigger:{" "}
                          {
                            workflow
                              .workflow_triggers?.[0]
                              ?.type || "None"
                          }
                        </span>

                        <span>
                          Latest run:{" "}
                          {
                            latestRun?.status ||
                            "Never run"
                          }
                        </span>

                      </div>

                      <div>

                        {workflow
                          .workflow_steps
                          ?.map((step) => (

                            <div
                              key={step.id}
                              style={styles.step}
                            >

                              {step.step_order}.
                              {" "}
                              {step.name}
                              {" "}
                              <small>
                                ({step.type})
                              </small>

                            </div>

                          ))}

                      </div>

                    </div>

                  );
                }
              )}

            </div>

          )}

      </main>

    </div>
  );
}

/* =========================================================
   STEP COMPONENT
   ========================================================= */

function Step({
  number,
  title,
  type,
  text,
}) {

  return (

    <div style={styles.stepCard}>

      <div style={styles.number}>
        {number}
      </div>

      <div>

        <h3 style={styles.stepTitle}>
          {title}
        </h3>

        <div style={styles.stepType}>
          {type}
        </div>

        <p style={styles.stepText}>
          {text}
        </p>

      </div>

    </div>
  );
}

/* =========================================================
   STYLES
   ========================================================= */

const styles = {

  page: {
    minHeight: "100vh",
    background: "#f5f7fb",
  },

  header: {
    background: "#172033",
    color: "white",
    padding: "20px 45px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  logo: {
    margin: 0,
    fontSize: "40px",
  },

  subtitle: {
    fontSize: "22px",
    marginTop: 5,
  },

  headerRight: {
    display: "flex",
    alignItems: "center",
  },

  user: {
    marginRight: 18,
    fontSize: 18,
  },

  logout: {
    padding: "10px 18px",
    border: "none",
    borderRadius: 7,
    cursor: "pointer",
  },

  content: {
    padding: "40px",
    maxWidth: 1200,
    margin: "auto",
  },

  titleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30,
  },

  title: {
    margin: 0,
    fontSize: 30,
  },

  description: {
    color: "#64748b",
    fontSize: 20,
  },

  createButton: {
    padding: "15px 24px",
    border: "none",
    borderRadius: 8,
    background: "#2563eb",
    color: "white",
    fontSize: 17,
    cursor: "pointer",
  },

  createCard: {
    background: "white",
    padding: 40,
    borderRadius: 15,
    marginBottom: 30,
    boxShadow:
      "0 2px 12px rgba(0,0,0,0.08)",
  },

  createHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  cancel: {
    padding: "10px 18px",
    border: "none",
    borderRadius: 7,
    background: "#e2e8f0",
    cursor: "pointer",
  },

  label: {
    display: "block",
    marginTop: 25,
    marginBottom: 10,
    fontSize: 20,
    fontWeight: 600,
  },

  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: 15,
    fontSize: 17,
    border:
      "1px solid #cbd5e1",
    borderRadius: 8,
  },

  section: {
    textAlign: "center",
    marginTop: 35,
    color: "#64748b",
  },

  stepCard: {
    display: "flex",
    alignItems: "center",
    background: "#f8fafc",
    border:
      "1px solid #dbe4ef",
    borderRadius: 10,
    padding: 20,
    marginBottom: 12,
  },

  number: {
    width: 42,
    height: 42,
    minWidth: 42,
    borderRadius: "50%",
    background: "#2563eb",
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 20,
    fontWeight: "bold",
  },

  stepTitle: {
    margin: 0,
    color: "#64748b",
  },

  stepType: {
    color: "#2563eb",
    marginTop: 5,
  },

  stepText: {
    color: "#64748b",
  },

  triggers: {
    background: "#ecfdf5",
    padding: 20,
    borderRadius: 8,
    color: "#475569",
    fontSize: 18,
  },

  save: {
    display: "block",
    margin: "25px auto 0",
    padding: "14px 30px",
    border: "none",
    borderRadius: 8,
    background: "#16a34a",
    color: "white",
    fontSize: 17,
    cursor: "pointer",
  },

  success: {
    background: "#dcfce7",
    color: "#166534",
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },

  error: {
    background: "#fee2e2",
    color: "#991b1b",
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },

  message: {
    padding: 30,
    textAlign: "center",
  },

  grid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fill,minmax(320px,1fr))",
    gap: 20,
  },

  card: {
    background: "white",
    padding: 25,
    borderRadius: 12,
    boxShadow:
      "0 2px 10px rgba(0,0,0,0.08)",
  },

  info: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
    marginTop: 15,
    color: "#475569",
  },

  step: {
    background: "#f1f5f9",
    padding: 10,
    marginTop: 7,
    borderRadius: 5,
  },
};

export default Dashboard;