const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "AgentFlow Backend",
  });
});

app.post("/triggerWorkflowRun", async (req, res) => {
  try {
    console.log("ACTION REQUEST:");
    console.log(JSON.stringify(req.body, null, 2));

    const workflowId = req.body?.input?.workflow_id;
    const sessionVariables = req.body?.session_variables || {};

    const userId =
      sessionVariables["x-hasura-user-id"];

    if (!workflowId) {
      return res.status(400).json({
        id: "",
        status: "failed",
        message: "workflow_id is required",
      });
    }

    if (!userId) {
      return res.status(401).json({
        id: "",
        status: "failed",
        message: "User authentication required",
      });
    }

    /*
      TEMPORARY EXECUTION TEST

      We will replace this with:
      1. org membership check
      2. quota check
      3. workflow run creation
      4. step execution
      5. LLM call
      6. HTTP request
      7. conditional branch
      8. approval gate
    */

    return res.json({
      id: workflowId,
      status: "started",
      message: "Workflow execution started",
    });

  } catch (error) {
    console.error("ACTION ERROR:", error);

    return res.status(500).json({
      id: "",
      status: "failed",
      message: error.message,
    });
  }
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`AgentFlow backend running on port ${PORT}`);
});