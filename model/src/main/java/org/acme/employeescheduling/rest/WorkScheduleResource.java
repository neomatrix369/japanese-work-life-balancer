package org.acme.employeescheduling.rest;

import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import ai.timefold.solver.core.api.domain.solution.ConstraintWeightOverrides;
import ai.timefold.solver.core.api.score.HardMediumSoftScore;
import ai.timefold.solver.core.api.solver.SolutionManager;
import ai.timefold.solver.core.api.solver.SolverConfigOverride;
import ai.timefold.solver.core.api.solver.SolverManager;
import ai.timefold.solver.core.api.solver.SolverStatus;

import org.acme.employeescheduling.domain.WorkSchedule;
import org.acme.employeescheduling.kpi.BrokenConstraints;
import org.acme.employeescheduling.kpi.BrokenConstraints.BrokenConstraint;
import org.acme.employeescheduling.kpi.KpiCalculator;
import org.acme.employeescheduling.kpi.UnassignedReasoner;
import org.acme.employeescheduling.rest.exception.EmployeeScheduleSolverException;
import org.acme.employeescheduling.solver.Presets;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Tag(name = "Work schedules", description = "Solve weekly work plans that prevent overwork.")
@Path("schedules")
public class WorkScheduleResource {

    private static final Logger LOGGER = LoggerFactory.getLogger(WorkScheduleResource.class);
    static final int DEFAULT_LIMIT_SECONDS = 30;
    static final int MIN_LIMIT_SECONDS = 5;
    static final int MAX_LIMIT_SECONDS = 60;

    private final SolverManager<WorkSchedule> solverManager;
    private final SolutionManager<WorkSchedule, HardMediumSoftScore> solutionManager;
    private final ScenarioRepository scenarios;

    // MOCK: in-memory job store, no persistence and no eviction.
    private final ConcurrentMap<String, Job> jobs = new ConcurrentHashMap<>();

    @Inject
    public WorkScheduleResource(SolverManager<WorkSchedule> solverManager,
            SolutionManager<WorkSchedule, HardMediumSoftScore> solutionManager, ScenarioRepository scenarios) {
        this.solverManager = solverManager;
        this.solutionManager = solutionManager;
        this.scenarios = scenarios;
    }

    @Operation(summary = "List the job IDs of all submitted schedules.")
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Collection<String> list() {
        return jobs.keySet();
    }

    @Operation(summary = "Start solving a full WorkSchedule. Returns the job id as plain text.")
    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.TEXT_PLAIN)
    public String solve(WorkSchedule problem, @QueryParam("preset") String preset,
            @QueryParam("limitSeconds") Integer limitSeconds) {
        if (problem == null) {
            throw new BadRequestException(
                    "Request body must be a WorkSchedule JSON; to solve a scenario by name use POST /schedules/scenario/{name}");
        }
        return startSolving(problem, preset, limitSeconds);
    }

    @Operation(summary = "Load a scenario from the data directory and start solving it. Returns the job id.")
    @POST
    @Path("scenario/{name}")
    @Produces(MediaType.TEXT_PLAIN)
    public String solveScenario(@PathParam("name") String name, @QueryParam("preset") String preset,
            @QueryParam("limitSeconds") Integer limitSeconds) {
        return startSolving(scenarios.load(name), preset, limitSeconds);
    }

    @Operation(summary = "The best plan so far, with KPIs, unassigned reasons and broken constraints.")
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Path("{jobId}")
    public ScheduleResponse get(@PathParam("jobId") String jobId) {
        Job job = findJob(jobId);
        WorkSchedule schedule = job.schedule();
        SolverStatus solverStatus = solverManager.getSolverStatus(jobId);
        schedule.setSolverStatus(solverStatus);
        String status = solverStatus.name();
        KpiCalculator.Result kpis = KpiCalculator.calculate(schedule);
        HardMediumSoftScore score = schedule.getScore(); // null until the solver publishes a first solution
        return new ScheduleResponse(schedule, kpis.kpis(), kpis.perEmployee(), kpis.shifts(),
                UnassignedReasoner.explain(schedule), kpis.longevity(),
                BrokenConstraints.compute(solutionManager, schedule),
                job.preset(), status, score == null ? null : score.toString());
    }

    @Operation(summary = "Status, score and preset only (cheap, for polling).")
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Path("{jobId}/status")
    public ScheduleResponse.Status status(@PathParam("jobId") String jobId) {
        Job job = findJob(jobId);
        HardMediumSoftScore score = job.schedule().getScore();
        return new ScheduleResponse.Status(solverManager.getSolverStatus(jobId).name(),
                score == null ? null : score.toString(), job.preset());
    }

    @Operation(summary = "Stop solving and return the best plan so far.")
    @DELETE
    @Produces(MediaType.APPLICATION_JSON)
    @Path("{jobId}")
    public ScheduleResponse stop(@PathParam("jobId") String jobId) {
        findJob(jobId);
        solverManager.terminateEarly(jobId);
        return get(jobId);
    }

    @Operation(summary = "Return the broken constraints of the given schedule (no solving).")
    @PUT
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    @Path("analyze")
    public List<BrokenConstraint> analyzeSchedule(WorkSchedule schedule, @QueryParam("preset") String preset) {
        schedule.prepare(presetOverrides(preset));
        return BrokenConstraints.compute(solutionManager, schedule);
    }

    // ************************************************************************
    // Internals
    // ************************************************************************

    private String startSolving(WorkSchedule problem, String preset, Integer limitSeconds) {
        String presetName = preset == null || preset.isBlank() ? Presets.DEFAULT : preset;
        problem.prepare(presetOverrides(presetName));
        int seconds = clampLimit(limitSeconds);
        String jobId = UUID.randomUUID().toString();
        jobs.put(jobId, Job.of(problem, presetName));
        solverManager.solveBuilder()
                .withProblemId(jobId)
                .withProblemFinder(id -> jobs.get(jobId).schedule())
                .withBestSolutionEventConsumer(event -> jobs.put(jobId, Job.of(event.solution(), presetName)))
                .withExceptionHandler((id, exception) -> {
                    jobs.put(jobId, Job.ofException(exception, presetName));
                    LOGGER.error("Failed solving jobId ({}).", jobId, exception);
                })
                .withConfigOverride(new SolverConfigOverride().withTerminationSpentLimit(Duration.ofSeconds(seconds)))
                .run();
        LOGGER.info("Started job {} (preset={}, limit={}s, tasks={}, employees={})", jobId, presetName, seconds,
                problem.getTasks().size(), problem.getEmployees().size());
        return jobId;
    }

    static int clampLimit(Integer limitSeconds) {
        int seconds = limitSeconds == null ? DEFAULT_LIMIT_SECONDS : limitSeconds;
        return Math.max(MIN_LIMIT_SECONDS, Math.min(MAX_LIMIT_SECONDS, seconds));
    }

    private static ConstraintWeightOverrides<HardMediumSoftScore> presetOverrides(String preset) {
        String name = preset == null || preset.isBlank() ? Presets.DEFAULT : preset;
        if (!Presets.exists(name)) {
            throw new BadRequestException("Unknown preset '" + name + "'. Use one of " + Presets.PRESETS.keySet());
        }
        return Presets.get(name);
    }

    private Job findJob(String jobId) {
        Job job = jobs.get(jobId);
        if (job == null) {
            throw new EmployeeScheduleSolverException(jobId, Response.Status.NOT_FOUND, "No schedule found.");
        }
        if (job.exception() != null) {
            throw new EmployeeScheduleSolverException(jobId, job.exception());
        }
        return job;
    }

    private record Job(WorkSchedule schedule, Throwable exception, String preset) {
        static Job of(WorkSchedule schedule, String preset) {
            return new Job(schedule, null, preset);
        }

        static Job ofException(Throwable exception, String preset) {
            return new Job(null, exception, preset);
        }
    }
}
