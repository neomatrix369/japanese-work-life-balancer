package org.acme.employeescheduling.rest;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

import org.acme.employeescheduling.domain.WorkSchedule;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import com.fasterxml.jackson.databind.ObjectMapper;

/** Reads scenario JSON files (written by data-gen) from {@code app.data-dir}. */
@ApplicationScoped
public class ScenarioRepository {

    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    private final Path dataDir;
    private final ObjectMapper objectMapper;

    @Inject
    public ScenarioRepository(@ConfigProperty(name = "app.data-dir", defaultValue = "../data-gen/out") String dataDir,
            ObjectMapper objectMapper) {
        this.dataDir = Path.of(dataDir);
        this.objectMapper = objectMapper;
    }

    /** Scenario names (file names without .json), sorted. Empty if the directory does not exist. */
    public List<String> names() {
        if (!Files.isDirectory(dataDir)) {
            return List.of();
        }
        try (Stream<Path> files = Files.list(dataDir)) {
            return files.map(p -> p.getFileName().toString())
                    .filter(f -> f.endsWith(".json"))
                    .map(f -> f.substring(0, f.length() - ".json".length()))
                    .filter(n -> SAFE_NAME.matcher(n).matches())
                    .sorted()
                    .toList();
        } catch (IOException e) {
            throw new IllegalStateException("Cannot list " + dataDir, e);
        }
    }

    public String raw(String name) {
        try {
            return Files.readString(file(name));
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read scenario " + name, e);
        }
    }

    public WorkSchedule load(String name) {
        try {
            return objectMapper.readValue(file(name).toFile(), WorkSchedule.class);
        } catch (IOException e) {
            throw new BadRequestException("Scenario " + name + " is not a valid WorkSchedule: " + e.getMessage());
        }
    }

    private Path file(String name) {
        // Allow-list the name: no path traversal.
        String clean = name.endsWith(".json") ? name.substring(0, name.length() - 5) : name;
        if (!SAFE_NAME.matcher(clean).matches()) {
            throw new BadRequestException("Invalid scenario name");
        }
        Path file = dataDir.resolve(clean + ".json");
        if (!Files.isRegularFile(file)) {
            throw new NotFoundException("Scenario not found: " + clean);
        }
        return file;
    }
}
