package org.acme.employeescheduling.rest;

import java.net.URI;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import org.eclipse.microprofile.config.inject.ConfigProperty;

/** GET / : this port is the API only, so send browsers to the dashboard instead of a 404. */
@Path("/")
public class RootResource {

    @ConfigProperty(name = "app.ui-url", defaultValue = "http://localhost:5173")
    String uiUrl;

    @GET
    @Produces(MediaType.TEXT_PLAIN)
    public Response root() {
        return Response.seeOther(URI.create(uiUrl))
                .entity("UI is at " + uiUrl + " — this port is the API (see /q/swagger-ui).")
                .build();
    }
}
