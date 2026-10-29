package org.acme.employeescheduling.rest;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.startsWith;

import java.time.Duration;

import org.awaitility.Awaitility;
import org.junit.jupiter.api.Test;

import io.quarkus.test.junit.QuarkusTest;

/** Smoke test of the REST API (test profile reads scenarios from src/test/resources). */
@QuarkusTest
class WorkScheduleResourceTest {

    @Test
    void listsAndLoadsScenarios() {
        given().when().get("/demo-data").then().statusCode(200).body("$", hasItem("tiny"));
        given().when().get("/demo-data/tiny").then().statusCode(200);
        given().when().get("/demo-data/bad.name").then().statusCode(400);
    }

    @Test
    void rootRedirectsToTheUi() {
        given().redirects().follow(false).when().get("/").then().statusCode(303)
                .header("Location", "http://localhost:5173");
    }

    @Test
    void rejectsUnknownPreset() {
        given().when().post("/schedules/scenario/tiny?preset=nope").then().statusCode(400);
    }

    @Test
    void allowsTheDashboardFromAnyLocalPort() {
        given().header("Origin", "http://localhost:5175").when().get("/demo-data")
                .then().statusCode(200).header("Access-Control-Allow-Origin", "http://localhost:5175");
    }

    @Test
    void doesNotAllowRemoteOrigins() {
        given().header("Origin", "https://evil.example").when().get("/demo-data")
                .then().header("Access-Control-Allow-Origin", org.hamcrest.Matchers.nullValue());
    }

    @Test
    void rejectsSolveWithoutBody() {
        given().contentType("application/json").when().post("/schedules?preset=health-first")
                .then().statusCode(400);
    }

    @Test
    void solvesScenarioAndReturnsKpisAndBrokenConstraints() {
        String jobId = given().when().post("/schedules/scenario/tiny?preset=cost-first&limitSeconds=5")
                .then().statusCode(200).extract().asString();
        Awaitility.await().atMost(Duration.ofSeconds(20)).pollInterval(Duration.ofMillis(500)).until(() -> "NOT_SOLVING"
                .equals(given().when().get("/schedules/" + jobId + "/status").jsonPath().getString("status")));

        given().when().get("/schedules/" + jobId).then().statusCode(200)
                .body("score", startsWith("0hard/"))
                .body("preset", org.hamcrest.Matchers.equalTo("cost-first"))
                .body("kpis.totalLaborCost", notNullValue())
                .body("perEmployee.size()", org.hamcrest.Matchers.equalTo(8))
                .body("brokenConstraints.name", hasItem("Labor cost"));

        given().contentType("application/json").body(given().when().get("/demo-data/tiny").asString())
                .when().put("/schedules/analyze").then().statusCode(200)
                .body("name", hasItem("Unassigned task"));
    }
}
