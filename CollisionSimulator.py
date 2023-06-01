import pygame
import math
import random
from pygame.math import Vector2
import pygame.mixer

pygame.init()
pygame.mixer.init()
pygame.display.set_caption('COLLISIONS SIMULATION')
# Constants
SCREEN_WIDTH = 840
SCREEN_HEIGHT = 680
FPS = 60
FONT_SIZE = 24
COLORS = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
MAX_TRAIL_LENGTH = 200
TRAIL_ALPHA = 10
TRAIL_THICKNESS = 2

collision_sound = pygame.mixer.Sound("efecto.mp3")


class Object:
    def __init__(self, mass, velocity, position, radius, color):
        self.mass = mass
        self.velocity = Vector2(velocity)
        self.position = Vector2(position)
        self.radius = radius
        self.color = color
        self.trail = []
        self.trail_color = []
        self.calculate_momentum_kinetic_energy()

    def calculate_momentum_kinetic_energy(self):
        # Calculate momentum and kinetic energy based on mass and velocity
        self.momentum = self.mass * self.velocity.length()
        self.kinetic_energy = 0.5 * self.mass * self.velocity.length_squared()

    def collide(self, other):
        # Handle collision between two objects
        relative_velocity = other.velocity - self.velocity
        collision_normal = (other.position - self.position).normalize()

        # Calculate impulse
        impulse = (2 * self.mass * other.mass * relative_velocity.dot(collision_normal)) / (
                self.mass + other.mass)

        # Update velocities
        self.velocity += impulse * collision_normal / self.mass
        other.velocity -= impulse * collision_normal / other.mass
        collision_sound.play()

        # Recalculate momentum and kinetic energy after collision
        self.calculate_momentum_kinetic_energy()
        other.calculate_momentum_kinetic_energy()

    def collides_with(self, position, radius):
        # Check if the object collides with another object based on positions and radii
        distance = math.sqrt((self.position.x - position.x) ** 2 + (self.position.y - position.y) ** 2)
        min_distance = self.radius + radius
        return distance < min_distance

    def update_position(self):
        # Update the position of the object and trail history
        self.trail.append(Vector2(self.position.x, self.position.y))
        if len(self.trail) > MAX_TRAIL_LENGTH:
            self.trail.pop(0)

        self.trail_color.append((*self.color, TRAIL_ALPHA))
        if len(self.trail_color) > MAX_TRAIL_LENGTH:
            self.trail_color.pop(0)

        self.position += self.velocity

    def draw(self, screen):
        # Draw the object on the screen as a circle
        x, y = int(self.position.x), int(self.position.y)
        pygame.draw.circle(screen, self.color, (x, y), self.radius)


def generate_objects(n):
    # Generate a list of random objects with random properties
    objects = []

    for _ in range(n):
        mass = random.uniform(1, 5)
        velocity = Vector2(random.uniform(-5, 5), random.uniform(-5, 5))
        radius = int(math.sqrt(mass) * 10)
        color = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))

        position = Vector2(random.uniform(100, SCREEN_WIDTH - 100), random.uniform(100, SCREEN_HEIGHT - 100))
        while any(obj.collides_with(position, radius) for obj in objects):
            position = Vector2(random.uniform(100, SCREEN_WIDTH - 100), random.uniform(100, SCREEN_HEIGHT - 100))

        objects.append(Object(mass, velocity, position, radius, color))

    return objects


def generate_objects_mod(n, velocities, masses, positions, color_i=None):
    # Generate a list of objects with predefined properties
    objects = []

    for i in range(n):
        mass = masses[i]
        velocity = velocities[i]
        position = positions[i]
        radius = int(math.sqrt(mass) * 10)  # Adjust the scaling factor (10) as desired
        if color_i is None:
            color = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
        else:
            color = color_i[i]

        while any(obj.collides_with(position, radius) for obj in objects):
            position = Vector2(random.uniform(100, SCREEN_WIDTH - 100), random.uniform(100, SCREEN_HEIGHT - 100))

        objects.append(Object(mass, velocity, position, radius, color))

    return objects


def handle_collisions(objects):
    # Handle collisions between all pairs of objects
    for i in range(len(objects)):
        for j in range(i + 1, len(objects)):
            obj1 = objects[i]
            obj2 = objects[j]
            distance = obj1.position.distance_to(obj2.position)
            if distance < obj1.radius + obj2.radius:
                obj1.collide(obj2)


def handle_screen_collision(obj, screen_width, screen_height):
    # Handle collision with the screen edges by changing velocity
    if obj.position.x - obj.radius < 0 or obj.position.x + obj.radius > screen_width:
        obj.velocity.x = -obj.velocity.x
        collision_sound.play()
    if obj.position.y - obj.radius < 0 or obj.position.y + obj.radius > screen_height:
        obj.velocity.y = -obj.velocity.y
        collision_sound.play()


def draw_objects(screen, objects):
    # Draw all the objects on the screen
    for obj in objects:
        obj.draw(screen)


def display_object_info(screen, objects, font, object_info):
    # Display information about each object on the screen
    if object_info:
        info_text = []
        for i, obj in enumerate(objects):
            velocity_angle, velocity_magnitude = obj.velocity.as_polar()
            text = (
                f'Object {i + 1}:  Mass={obj.mass:.2f}  Velocity=({obj.velocity.x:.2f}, {obj.velocity.y:.2f})  '
                f'Momentum=({obj.mass * obj.velocity.x:.2f}, {obj.mass * obj.velocity.y:.2f})'
            )
            # Append the color information to the text
            color_text = obj.color
            info_text.append((text, color_text))

        line_height = font.get_linesize()
        y = 10
        for text, color_text in info_text:
            text_surface = font.render(text, True, color_text)
            text_rect = text_surface.get_rect()
            text_rect.topleft = (10, y)
            screen.blit(text_surface, text_rect)
            y += line_height

        return y + line_height
    else:
        return 10


def display_system_info(screen, objects, font, y, object_info):
    # Display information about the overall system on the screen
    if object_info:
        total_momentum_x = sum(obj.mass * obj.velocity.x for obj in objects)
        total_momentum_y = sum(obj.mass * obj.velocity.y for obj in objects)
        total_momentum = math.sqrt(total_momentum_x ** 2 + total_momentum_y ** 2)

        text_momentum = f'Total Momentum: {total_momentum:.2f}'
        text_momentum_x = f'Total Momentum (X): {total_momentum_x:.2f}'
        text_momentum_y = f'Total Momentum (Y): {total_momentum_y:.2f}'

        text_surface_momentum = font.render(text_momentum, True, (255, 255, 255))
        text_rect_momentum = text_surface_momentum.get_rect()
        text_rect_momentum.topleft = (10, y)
        screen.blit(text_surface_momentum, text_rect_momentum)

        text_surface_momentum_x = font.render(text_momentum_x, True, (255, 255, 255))
        text_rect_momentum_x = text_surface_momentum_x.get_rect()
        text_rect_momentum_x.topleft = (10, y + text_rect_momentum.height)
        screen.blit(text_surface_momentum_x, text_rect_momentum_x)

        text_surface_momentum_y = font.render(text_momentum_y, True, (255, 255, 255))
        text_rect_momentum_y = text_surface_momentum_y.get_rect()
        text_rect_momentum_y.topleft = (10, y + text_rect_momentum.height + text_rect_momentum_x.height)
        screen.blit(text_surface_momentum_y, text_rect_momentum_y)
    else:
        total_momentum_x = sum(obj.mass * obj.velocity.x for obj in objects)
        total_momentum_y = sum(obj.mass * obj.velocity.y for obj in objects)
        total_momentum = math.sqrt(total_momentum_x ** 2 + total_momentum_y ** 2)

        text_momentum = f'Total Momentum: {total_momentum:.2f}'
        text_momentum_x = f'Total Momentum (X): {total_momentum_x:.2f}'
        text_momentum_y = f'Total Momentum (Y): {total_momentum_y:.2f}'

        text_surface_momentum = font.render(text_momentum, True, (255, 255, 255))
        text_rect_momentum = text_surface_momentum.get_rect()
        text_rect_momentum.topleft = (10, y)
        screen.blit(text_surface_momentum, text_rect_momentum)

        text_surface_momentum_x = font.render(text_momentum_x, True, (255, 255, 255))
        text_rect_momentum_x = text_surface_momentum_x.get_rect()
        text_rect_momentum_x.topleft = (10, y + text_rect_momentum.height)
        screen.blit(text_surface_momentum_x, text_rect_momentum_x)

        text_surface_momentum_y = font.render(text_momentum_y, True, (255, 255, 255))
        text_rect_momentum_y = text_surface_momentum_y.get_rect()
        text_rect_momentum_y.topleft = (10, y + text_rect_momentum.height + text_rect_momentum_x.height)
        screen.blit(text_surface_momentum_y, text_rect_momentum_y)


def draw_trails(screen, objects):
    # Draw the trails of each object on the screen
    for obj in objects:
        if len(obj.trail) > 1:
            for i in range(len(obj.trail) - 1):
                start_pos = obj.trail[i]
                end_pos = obj.trail[i + 1]
                color = obj.trail_color[i]
                pygame.draw.line(screen, color, start_pos, end_pos, TRAIL_THICKNESS)


# Define velocities, masses, and positions for objects
velocities = [Vector2(1, 1), Vector2(-1, -1)]
masses = [2, 3]
positions = [Vector2(150, 210), Vector2(600, 620)]
colors = [(232, 18, 36), (66, 201, 237)]

def main():
    # Main simulation loop
    screen = pygame.display.set_mode((SCREEN_WIDTH, SCREEN_HEIGHT))
    clock = pygame.time.Clock()
    font = pygame.font.Font(None, FONT_SIZE)

    # Generate objects with the predefined properties
    # objects = generate_objects_mod(2, velocities, masses, positions, colors)
    objects = generate_objects(50)
    info = True
    bounce_off_edges = False
    trace_val = True
    object_info = False

    pause = False
    selected_object = None
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            elif event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    pause = not pause
            elif event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:  # Left mouse button
                    mouse_position = Vector2(event.pos)
                    for obj in objects:
                        if obj.position.distance_to(mouse_position) <= obj.radius:
                            selected_object = obj
            elif event.type == pygame.MOUSEBUTTONUP:
                if event.button == 1:  # Left mouse button
                    selected_object = None
            elif event.type == pygame.MOUSEMOTION:
                if selected_object is not None:
                    selected_object.position = Vector2(event.pos)

        if not pause:
            screen.fill((0, 0, 0))

            handle_collisions(objects)

            if bounce_off_edges:
                for obj in objects:
                    handle_screen_collision(obj, SCREEN_WIDTH, SCREEN_HEIGHT)

            for obj in objects:
                obj.update_position()
                obj.draw(screen)
            if trace_val:
                draw_trails(screen, objects)

            if info:
                y = display_object_info(screen, objects, font, object_info)
                display_system_info(screen, objects, font, y, object_info)

            pygame.display.flip()
            clock.tick(FPS)

    pygame.quit()


if __name__ == '__main__':
    main()
